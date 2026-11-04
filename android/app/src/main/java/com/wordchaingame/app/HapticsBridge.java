package com.wordchaingame.app;

import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.webkit.JavascriptInterface;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Asynchronous, zero-blocking Haptics Bridge for Android WebView.
 * All Binder IPC calls to Android's VibratorService are offloaded onto a single
 * dedicated background executor thread so JavaScript touch handlers return in <0.02ms.
 */
public class HapticsBridge {
    private final Vibrator vibrator;
    private final boolean hasVibrator;
    private final boolean hasAmplitudeControl;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService hapticExecutor = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "WordChain-Haptics");
        t.setPriority(Thread.NORM_PRIORITY - 1);
        t.setDaemon(true);
        return t;
    });

    private final VibrationEffect predefinedClick;
    private final VibrationEffect predefinedHeavyClick;
    private final VibrationEffect predefinedTick;

    public HapticsBridge(Context context) {
        Vibrator v = null;
        boolean hv = false;
        boolean amp = false;
        VibrationEffect click = null;
        VibrationEffect heavy = null;
        VibrationEffect tick = null;

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager vm = (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                v = vm != null ? vm.getDefaultVibrator() : (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            } else {
                v = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            }
            if (v != null && v.hasVibrator()) {
                hv = true;
                amp = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && v.hasAmplitudeControl());
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    try {
                        click = VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK);
                        heavy = VibrationEffect.createPredefined(VibrationEffect.EFFECT_HEAVY_CLICK);
                        tick = VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK);
                    } catch (Throwable ignored) {}
                }
            }
        } catch (Throwable ignored) {
            v = null;
            hv = false;
            amp = false;
        }
        this.vibrator = v;
        this.hasVibrator = hv;
        this.hasAmplitudeControl = amp;
        this.predefinedClick = click;
        this.predefinedHeavyClick = heavy;
        this.predefinedTick = tick;
    }

    /**
     * Ultra-fast primitive entry point called from AudioManager.haptic on Android.
     * Avoids JSON serialization/parsing and dispatches asynchronously.
     */
    @JavascriptInterface
    public void tap(final int ms) {
        if (!hasVibrator || vibrator == null) return;
        hapticExecutor.execute(() -> {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    VibrationEffect pre = (ms >= 35) ? predefinedHeavyClick : ((ms <= 12) ? predefinedTick : predefinedClick);
                    if (pre != null) {
                        vibrator.vibrate(pre);
                        return;
                    }
                }
                long durationMs = Math.max(10L, Math.min(80L, (long) ms));
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    int amplitude = hasAmplitudeControl
                            ? Math.max(40, Math.min(255, ms * 6))
                            : VibrationEffect.DEFAULT_AMPLITUDE;
                    vibrator.vibrate(VibrationEffect.createOneShot(durationMs, amplitude));
                } else {
                    vibrator.vibrate(durationMs);
                }
            } catch (Throwable ignored) {}
        });
    }

    @JavascriptInterface
    public void postMessage(final String messageJson) {
        if (!hasVibrator || vibrator == null || messageJson == null) return;
        hapticExecutor.execute(() -> {
            try {
                JSONObject obj = new JSONObject(messageJson);
                String type = obj.optString("type", "");
                if ("pattern".equals(type)) {
                    JSONArray events = obj.optJSONArray("events");
                    if (events != null && events.length() > 0) {
                        playPattern(events);
                    }
                }
            } catch (Throwable ignored) {}
        });
    }

    private void playPattern(JSONArray events) {
        int len = Math.min(events.length(), 8);
        for (int i = 0; i < len; i++) {
            JSONObject ev = events.optJSONObject(i);
            if (ev == null) continue;
            double t = ev.optDouble("t", 0.0);
            double intensity = Math.max(0.0, Math.min(1.0, ev.optDouble("i", 0.5)));
            double sharpness = Math.max(0.0, Math.min(1.0, ev.optDouble("s", 0.5)));
            double duration = Math.max(0.0, Math.min(0.5, ev.optDouble("d", 0.0)));

            long delayMs = Math.max(0L, (long) (t * 1000.0));
            if (delayMs == 0L) {
                triggerSingle(intensity, sharpness, duration);
            } else {
                mainHandler.postDelayed(() -> hapticExecutor.execute(() -> triggerSingle(intensity, sharpness, duration)), delayMs);
            }
        }
    }

    private void triggerSingle(double intensity, double sharpness, double durationSec) {
        if (!hasVibrator || vibrator == null) return;

        long durationMs;
        if (durationSec > 0) {
            durationMs = Math.max(10L, Math.min(200L, (long) (durationSec * 1000.0)));
        } else {
            durationMs = Math.max(12L, (long) (12 + intensity * 18));
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                VibrationEffect pre;
                if (sharpness > 0.65 || intensity > 0.8) {
                    pre = predefinedHeavyClick;
                } else if (intensity < 0.3 || sharpness < 0.2) {
                    pre = predefinedTick;
                } else {
                    pre = predefinedClick;
                }
                if (pre != null) {
                    vibrator.vibrate(pre);
                    return;
                }
            } catch (Throwable ignored) {}
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            int amplitude = hasAmplitudeControl
                    ? Math.max(1, Math.min(255, (int) Math.round(intensity * 255)))
                    : VibrationEffect.DEFAULT_AMPLITUDE;
            try {
                vibrator.vibrate(VibrationEffect.createOneShot(durationMs, amplitude));
                return;
            } catch (Throwable ignored) {}
        }

        try {
            vibrator.vibrate(durationMs);
        } catch (Throwable ignored) {}
    }

    public void shutdown() {
        try {
            hapticExecutor.shutdownNow();
        } catch (Throwable ignored) {}
    }
}
