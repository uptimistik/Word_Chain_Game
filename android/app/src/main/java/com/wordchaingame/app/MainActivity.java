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
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {
    private static final String TAG = "WordChain";
    private WebView webView;

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
            setImmersiveMode();

            webView = new WebView(this);
            webView.setBackgroundColor(Color.BLACK);
            webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
            webView.setVerticalScrollBarEnabled(false);
            webView.setHorizontalScrollBarEnabled(false);

            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setAllowFileAccess(true);
            settings.setAllowContentAccess(true);
            settings.setAllowFileAccessFromFileURLs(true);
            settings.setAllowUniversalAccessFromFileURLs(true);
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(true);
            settings.setSupportZoom(false);
            settings.setBuiltInZoomControls(false);
            settings.setDisplayZoomControls(false);

            // Register Haptics Bridge safely
            try {
                webView.addJavascriptInterface(new HapticsBridge(this), "AndroidHaptics");
            } catch (Throwable t) {
                Log.w(TAG, "HapticsBridge initialization skipped: " + t.getMessage());
            }

            // WebChromeClient for console logs
            webView.setWebChromeClient(new WebChromeClient() {
                @Override
                public boolean onConsoleMessage(ConsoleMessage cm) {
                    Log.d(TAG + "-JS", cm.message() + " -- From line " + cm.lineNumber() + " of " + cm.sourceId());
                    return true;
                }
            });

            // Custom WebViewClient to serve local assets under https://localhost/
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
            webView.loadUrl("https://localhost/3d.html");
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
        // Strip any query strings or hashes
        int q = path.indexOf('?');
        if (q >= 0) path = path.substring(0, q);
        int h = path.indexOf('#');
        if (h >= 0) path = path.substring(0, h);

        try {
            AssetManager am = getAssets();
            InputStream is = am.open("www/" + path);
            String mimeType = getMimeType(path);
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Cache-Control", "no-cache");
            return new WebResourceResponse(mimeType, "UTF-8", 200, "OK", headers, is);
        } catch (Exception e) {
            // NEVER return null InputStream inside WebResourceResponse, as Chromium throws NPE
            Map<String, String> headers = new HashMap<>();
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

    private void setImmersiveMode() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                WindowInsetsController controller = getWindow().getInsetsController();
                if (controller != null) {
                    controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                    controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                }
            } else {
                getWindow().getDecorView().setSystemUiVisibility(
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
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
