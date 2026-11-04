package com.wordchaingame.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.res.AssetManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import java.io.BufferedInputStream;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {
    private static final String TAG = "WordChain";
    private WebView webView;
    private HapticsBridge hapticsBridge;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Global crash handler to catch unexpected background thread errors
        Thread.setDefaultUncaughtExceptionHandler((thread, throwable) -> {
            Log.e(TAG, "Uncaught exception in thread " + thread.getName(), throwable);
        });

        try {
            // Keep screen on during gameplay
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

            webView = new WebView(this);
            webView.setBackgroundColor(Color.BLACK);
            // IMPORTANT: Do NOT set LAYER_TYPE_HARDWARE on WebView!
            // WebView is already hardware-accelerated by the window; forcing LAYER_TYPE_HARDWARE
            // allocates a redundant full-screen offscreen FBO in OpenGLRenderer that stalls Mali GPUs for 5+ seconds.
            webView.setLayerType(View.LAYER_TYPE_NONE, null);
            webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
            webView.setVerticalScrollBarEnabled(false);
            webView.setHorizontalScrollBarEnabled(false);
            webView.setFocusable(true);
            webView.setFocusableInTouchMode(true);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
            }

            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setCacheMode(WebSettings.LOAD_DEFAULT);
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setAllowFileAccess(true);
            settings.setAllowContentAccess(true);
            settings.setAllowFileAccessFromFileURLs(true);
            settings.setAllowUniversalAccessFromFileURLs(true);
            settings.setUseWideViewPort(false);
            settings.setLoadWithOverviewMode(false);
            settings.setSupportZoom(false);
            settings.setBuiltInZoomControls(false);
            settings.setDisplayZoomControls(false);
            settings.setGeolocationEnabled(false);

            // Register Haptics Bridge safely
            try {
                hapticsBridge = new HapticsBridge(this);
                webView.addJavascriptInterface(hapticsBridge, "AndroidHaptics");
            } catch (Throwable t) {
                Log.w(TAG, "HapticsBridge initialization skipped: " + t.getMessage());
            }

            // WebChromeClient: only log errors to avoid logcat I/O overhead during gameplay
            webView.setWebChromeClient(new WebChromeClient() {
                @Override
                public boolean onConsoleMessage(ConsoleMessage cm) {
                    if (cm != null && cm.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                        Log.e(TAG + "-JS", cm.message() + " -- From line " + cm.lineNumber() + " of " + cm.sourceId());
                    }
                    return true;
                }
            });

            // Custom WebViewClient to serve local assets under https://localhost/ with memory caching
            webView.setWebViewClient(new WebViewClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    if (request == null || request.getUrl() == null) return null;
                    Uri uri = request.getUrl();
                    if ("localhost".equals(uri.getHost())) {
                        return handleLocalAsset(uri.getPath());
                    }
                    return super.shouldInterceptRequest(view, request);
                }

                @Override
                public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                    super.onReceivedError(view, request, error);
                    if (request != null && error != null) {
                        Log.e(TAG, "WebView error loading " + request.getUrl() + ": " + error.getDescription());
                    }
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    super.onPageFinished(view, url);
                    try {
                        String css = "html,body{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;overscroll-behavior:none;}";
                        String js = "var s=document.createElement('style');s.textContent='" + css + "';document.documentElement.appendChild(s);";
                        view.evaluateJavascript(js, null);
                    } catch (Throwable ignored) {
                    }
                }
            });

            setContentView(webView);
            // Apply immersive mode and start loading URL after DecorView is attached so onCreate() returns immediately
            webView.post(() -> {
                setImmersiveMode();
                if (webView != null) {
                    webView.loadUrl("https://localhost/3d.html");
                }
            });
        } catch (Throwable t) {
            Log.e(TAG, "Critical error during MainActivity.onCreate()", t);
            FrameLayout root = new FrameLayout(this);
            root.setBackgroundColor(Color.BLACK);
            TextView tv = new TextView(this);
            tv.setTextColor(Color.YELLOW);
            tv.setTextSize(14);
            tv.setPadding(32, 48, 32, 32);
            tv.setText("Error al iniciar la app:\n\n" + Log.getStackTraceString(t));
            root.addView(tv);
            setContentView(root);
        }
    }

    private WebResourceResponse handleLocalAsset(String path) {
        if (path == null || path.isEmpty() || path.equals("/")) {
            path = "3d.html";
        }
        if (path.startsWith("/")) {
            path = path.substring(1);
        }
        int q = path.indexOf('?');
        if (q >= 0) path = path.substring(0, q);
        int h = path.indexOf('#');
        if (h >= 0) path = path.substring(0, h);

        try {
            AssetManager am = getAssets();
            InputStream rawStream = am.open("www/" + path, AssetManager.ACCESS_RANDOM);
            InputStream is = new BufferedInputStream(rawStream, 32768);
            String mimeType = getMimeType(path);
            String encoding = isTextMimeType(mimeType) ? "UTF-8" : null;
            Map<String, String> headers = new HashMap<>(2);
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Cache-Control", "public, max-age=31536000, immutable");
            return new WebResourceResponse(mimeType, encoding, 200, "OK", headers, is);
        } catch (Exception e) {
            Map<String, String> headers = new HashMap<>(1);
            headers.put("Access-Control-Allow-Origin", "*");
            byte[] empty = new byte[0];
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", headers, new ByteArrayInputStream(empty));
        }
    }

    private String getMimeType(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".m4a")) return "audio/mp4";
        if (p.endsWith(".ogg")) return "audio/ogg";
        if (p.endsWith(".mp3")) return "audio/mpeg";
        if (p.endsWith(".wav")) return "audio/wav";
        if (p.endsWith(".ttf")) return "font/ttf";
        if (p.endsWith(".otf")) return "font/otf";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    private boolean isTextMimeType(String mimeType) {
        if (mimeType == null) return false;
        return mimeType.startsWith("text/")
            || mimeType.equals("application/javascript")
            || mimeType.equals("application/json")
            || mimeType.equals("image/svg+xml");
    }

    private void setImmersiveMode() {
        try {
            if (getWindow() == null) return;
            View decorView = getWindow().peekDecorView();
            if (decorView == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                WindowInsetsController controller = decorView.getWindowInsetsController();
                if (controller != null) {
                    controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                    controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                }
            } else {
                decorView.setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                );
            }
        } catch (Throwable t) {
            Log.w(TAG, "setImmersiveMode exception: " + t.getMessage());
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            setImmersiveMode();
            if (webView != null) {
                webView.evaluateJavascript("if (window.AudioManager && typeof window.AudioManager.onAppForeground === 'function') window.AudioManager.onAppForeground();", null);
            }
        } else {
            if (webView != null) {
                webView.evaluateJavascript("if (window.AudioManager && typeof window.AudioManager.onAppBackground === 'function') window.AudioManager.onAppBackground();", null);
            }
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
            webView.evaluateJavascript("if (window.AudioManager && typeof window.AudioManager.onAppForeground === 'function') window.AudioManager.onAppForeground();", null);
        }
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            webView.evaluateJavascript("if (window.AudioManager && typeof window.AudioManager.onAppBackground === 'function') window.AudioManager.onAppBackground();", null);
            webView.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (hapticsBridge != null) {
            hapticsBridge.shutdown();
            hapticsBridge = null;
        }
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
