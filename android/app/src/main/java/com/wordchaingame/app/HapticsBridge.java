package com.wordchaingame.app;

import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.webkit.JavascriptInterface;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Handles haptic vibration requests from js/haptics-bridge.js via
 * window.AndroidHaptics.postMessage(json).
 */
public class HapticsBridge {
    private final Vibrator vibrator;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final boolean hasAmplitudeControl;

    public HapticsBridge(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager vm = (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            this.vibrator = vm != null ? vm.getDefaultVibrator() : (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
        } else {
            this.vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
        }
        this.hasAmplitudeControl = vibrator != null && vibrator.hasVibrator() &&
                (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && vibrator.hasAmplitudeControl());
    }

    @JavascriptInterface
    public void postMessage(String messageJson) {
        if (vibrator == null || !vibrator.hasVibrator() || messageJson == null) return;
        try {
            JSONObject obj = new JSONObject(messageJson);
            String type = obj.optString("type", "");
            if ("pattern".equals(type)) {
                JSONArray events = obj.optJSONArray("events");
                if (events != null && events.length() > 0) {
                    playPattern(events);
                }
            }
        } catch (Exception ignored) {
        }
    }

    private void playPattern(JSONArray events) {
        int len = Math.min(events.length(), 12);
        for (int i = 0; i < len; i++) {
            JSONObject ev = events.optJSONObject(i);
            if (ev == null) continue;
            double t = ev.optDouble("t", 0.0);
            double intensity = Math.max(0.0, Math.min(1.0, ev.optDouble("i", 0.5)));
            double sharpness = Math.max(0.0, Math.min(1.0, ev.optDouble("s", 0.5)));
            double duration = Math.max(0.0, Math.min(0.5, ev.optDouble("d", 0.0)));

            long delayMs = Math.max(0, (long) (t * 1000.0));
            if (delayMs == 0) {
                triggerSingle(intensity, sharpness, duration);
            } else {
                mainHandler.postDelayed(() -> triggerSingle(intensity, sharpness, duration), delayMs);
            }
        }
    }

    private void triggerSingle(double intensity, double sharpness, double durationSec) {
        if (vibrator == null || !vibrator.hasVibrator()) return;

        long durationMs;
        if (durationSec > 0) {
            durationMs = Math.max(10, Math.min(500, (long) (durationSec * 1000.0)));
        } else {
            durationMs = Math.max(15, (long) (15 + intensity * 20));
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && durationSec == 0) {
            try {
                int effectId;
                if (sharpness > 0.65 || intensity > 0.8) {
                    effectId = VibrationEffect.EFFECT_HEAVY_CLICK;
                } else if (intensity < 0.3 || sharpness < 0.2) {
                    effectId = VibrationEffect.EFFECT_TICK;
                } else {
                    effectId = VibrationEffect.EFFECT_CLICK;
                }
                vibrator.vibrate(VibrationEffect.createPredefined(effectId));
                return;
            } catch (Exception ignored) {}
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            int amplitude = hasAmplitudeControl
                    ? Math.max(1, Math.min(255, (int) Math.round(intensity * 255)))
                    : VibrationEffect.DEFAULT_AMPLITUDE;
            try {
                vibrator.vibrate(VibrationEffect.createOneShot(durationMs, amplitude));
                return;
            } catch (Exception ignored) {}
        }

        try {
            vibrator.vibrate(durationMs);
        } catch (Exception ignored) {}
    }
}

