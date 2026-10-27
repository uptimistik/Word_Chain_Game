import UIKit
import CoreHaptics

/// Plays the varied haptic patterns requested by js/haptics-bridge.js.
///
/// Each pattern is a list of events:
///   t = start offset (seconds), i = intensity 0...1, s = sharpness 0...1,
///   d = optional duration (seconds) -> continuous rumble instead of a tap.
///
/// Uses Core Haptics (iPhone 8 and later). Falls back to
/// UIImpactFeedbackGenerator on hardware without Core Haptics support.
final class Haptics {

    static let shared = Haptics()

    struct Event {
        let time: TimeInterval
        let intensity: Float
        let sharpness: Float
        let duration: TimeInterval
    }

    private let supportsCoreHaptics = CHHapticEngine.capabilitiesForHardware().supportsHaptics
    private var engine: CHHapticEngine?
    private var engineRunning = false
    private let queue = DispatchQueue(label: "wordchain.haptics", qos: .userInteractive)

    // Fallback generators.
    private lazy var light = UIImpactFeedbackGenerator(style: .light)
    private lazy var medium = UIImpactFeedbackGenerator(style: .medium)
    private lazy var heavy = UIImpactFeedbackGenerator(style: .heavy)
    private lazy var rigid = UIImpactFeedbackGenerator(style: .rigid)
    private lazy var soft = UIImpactFeedbackGenerator(style: .soft)

    private init() {}

    // MARK: - Lifecycle

    func start() {
        guard supportsCoreHaptics else {
            DispatchQueue.main.async { [self] in
                [light, medium, heavy, rigid, soft].forEach { $0.prepare() }
            }
            return
        }
        queue.async { [self] in
            do {
                if engine == nil {
                    let e = try CHHapticEngine()
                    e.playsHapticsOnly = true
                    e.isAutoShutdownEnabled = true
                    e.stoppedHandler = { [weak self] _ in
                        self?.queue.async { self?.engineRunning = false }
                    }
                    e.resetHandler = { [weak self] in
                        self?.queue.async {
                            self?.engineRunning = false
                            try? self?.engine?.start()
                            self?.engineRunning = true
                        }
                    }
                    engine = e
                }
                if !engineRunning {
                    try engine?.start()
                    engineRunning = true
                }
            } catch {
                NSLog("[Haptics] engine start failed: \(error)")
            }
        }
    }

    func stop() {
        guard supportsCoreHaptics else { return }
        queue.async { [self] in
            engine?.stop(completionHandler: nil)
            engineRunning = false
        }
    }

    // MARK: - Playback

    func play(_ events: [Event]) {
        guard !events.isEmpty else { return }
        if supportsCoreHaptics {
            queue.async { [self] in playCore(events) }
        } else {
            playFallback(events)
        }
    }

    private func playCore(_ events: [Event]) {
        guard let engine = engine else { start(); return }
        if !engineRunning {
            do { try engine.start(); engineRunning = true } catch { return }
        }
        let hapticEvents: [CHHapticEvent] = events.map { ev in
            let params = [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: ev.intensity),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: ev.sharpness)
            ]
            if ev.duration > 0 {
                return CHHapticEvent(eventType: .hapticContinuous, parameters: params,
                                     relativeTime: ev.time, duration: ev.duration)
            }
            return CHHapticEvent(eventType: .hapticTransient, parameters: params,
                                 relativeTime: ev.time)
        }
        do {
            let pattern = try CHHapticPattern(events: hapticEvents, parameters: [])
            let player = try engine.makePlayer(with: pattern)
            try player.start(atTime: CHHapticTimeImmediate)
        } catch {
            NSLog("[Haptics] play failed: \(error)")
        }
    }

    private func playFallback(_ events: [Event]) {
        for ev in events where ev.duration == 0 {
            DispatchQueue.main.asyncAfter(deadline: .now() + ev.time) { [self] in
                let generator: UIImpactFeedbackGenerator
                switch (ev.intensity, ev.sharpness) {
                case (_, let s) where s < 0.2: generator = soft
                case (_, let s) where s > 0.65: generator = rigid
                case (let i, _) where i > 0.8: generator = heavy
                case (let i, _) where i > 0.45: generator = medium
                default: generator = light
                }
                generator.impactOccurred(intensity: CGFloat(ev.intensity))
                generator.prepare()
            }
        }
    }

    // MARK: - JS message parsing

    func handle(message body: Any) {
        guard let dict = body as? [String: Any], let type = dict["type"] as? String else { return }
        switch type {
        case "prime":
            start()
        case "pattern":
            guard let raw = dict["events"] as? [[String: Any]] else { return }
            let events: [Event] = raw.prefix(12).map { e in
                Event(time: max(0, Self.num(e["t"])),
                      intensity: Float(min(1, max(0, Self.num(e["i"])))),
                      sharpness: Float(min(1, max(0, Self.num(e["s"])))),
                      duration: min(0.5, max(0, Self.num(e["d"]))))
            }
            play(events)
        default:
            break
        }
    }

    private static func num(_ v: Any?) -> Double {
        if let n = v as? NSNumber { return n.doubleValue }
        if let d = v as? Double { return d }
        return 0
    }
}
