package dev.firfall.mobile;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.JavascriptInterface;
import android.widget.FrameLayout;
import android.widget.Toast;

/**
 * FirFall for Android.
 *
 * The whole app is one self-contained HTML file in assets/, served over
 * file://. It is the same file that is published at
 * firfall.b8golddude.workers.dev/mobile/, so the app and the mobile page can
 * never drift apart in what they show.
 *
 * Bundling it locally rather than pointing the WebView at the URL is
 * deliberate: the shell has to open instantly and look right even on a bad
 * connection, and a remote page in a WebView is indistinguishable from a
 * browser. Content still comes from the live API, so there is no stale copy
 * of anyone's videos here.
 */
public class MainActivity extends Activity {

    private WebView web;
    private FrameLayout root;
    private View fullScreenView;
    private WebChromeClient.CustomViewCallback customViewCallback;

    /** Pending web file-chooser callback from the ember gallery picker. */
    private ValueCallback<Uri[]> fileChooserCallback;
    private static final int FILE_CHOOSER_REQUEST = 1001;

    /** Anything not on our own origin opens in the user's real browser. */
    private static final String[] OWN_HOSTS = {
        "file://", "dev.firfall.mobile", "firfall.b8golddude.workers.dev",
        "firfall-auth.b8golddude.workers.dev"
    };

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0f0f0f"));
        root.setLayoutParams(new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0f0f0f"));
        web.setLayoutParams(new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        // The app keeps its session token and cached report flags in
        // localStorage, which is off by default and breaks sign-in without it.
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            s.setSafeBrowsingEnabled(false);
        }
        // This is our own content served from assets; file access is only
        // granted where the app itself needs it.
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            s.setAllowFileAccessFromFileURLs(false);
            s.setAllowUniversalAccessFromFileURLs(false);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }

        CookieManager.getInstance().setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        }

        // Keep the screen on during playback. The player is a single <video>,
        // so there is no reliable native "is playing" signal to hook here; the
        // web layer turns this off again when it pauses.
        web.addJavascriptInterface(new Bridge(), "Android");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                return handleUrl(req.getUrl());
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                enterFullScreen(view, callback);
            }

            @Override
            public void onHideCustomView() {
                exitFullScreen();
            }

            /**
             * Ember recording uses getUserMedia from the page. Without this
             * override the WebView denies the request silently and the camera
             * screen closes with "Camera unavailable". The app-level runtime
             * permissions are requested in onCreate; granting here hands the
             * devices to the page the moment it asks for them.
             */
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    public void run() {
                        try {
                            request.grant(request.getResources());
                        } catch (Exception e) {
                            request.deny();
                        }
                    }
                });
            }

            /**
             * The "From gallery" ember picker is a hidden <input type=file>.
             * A WebView shows nothing at all for it unless the shell forwards
             * to the system document picker, so this is the other half of
             * uploading a clip you already recorded.
             */
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileChooserCallback != null) {
                    fileChooserCallback.onReceiveValue(null);
                }
                fileChooserCallback = callback;
                try {
                    Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("video/*");
                    String[] types = params.getAcceptTypes();
                    if (types != null && types.length > 0 && types[0] != null && types[0].length() > 0) {
                        i.setType(types[0]);
                    }
                    startActivityForResult(
                        Intent.createChooser(i, "Choose a clip"), FILE_CHOOSER_REQUEST);
                } catch (ActivityNotFoundException e) {
                    fileChooserCallback = null;
                    Toast.makeText(MainActivity.this, "No app can pick a video.", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                // Anything the page logs is worth having in logcat when
                // debugging on a real phone, where there is no inspector.
                android.util.Log.d("FirFall", m.message() + " @" + m.lineNumber());
                return true;
            }
        });

        // A fresh build should not show the previous version's shell. HTML
        // inside a WebView is cached aggressively and the user has no dev
        // tools on a phone, so bypass the cache for our own asset.
        web.clearCache(true);

        root.addView(web);
        setContentView(root);

        // Dark status bar so the app's own black chrome runs to the top. The
        // page paints #0f0f0f behind it, so the bar has to match or there is
        // a pale stripe above the app on every screen.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setStatusBarColor(Color.parseColor("#0f0f0f"));
            getWindow().setNavigationBarColor(Color.parseColor("#0f0f0f"));
        }

        web.loadUrl("file:///android_asset/index.html");

        // Camera + microphone for ember recording. Asked for once up front
        // rather than at first use: WebView fires the page's getUserMedia
        // request immediately when the camera screen opens, and a permission
        // dialog stacked on top of it is a confusing place to explain why.
        // A denial is not fatal - the sheet still offers the gallery picker.
        requestCamPerms();
    }

    private void requestCamPerms() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        String[] wanted = new String[]{
            "android.permission.CAMERA", "android.permission.RECORD_AUDIO"
        };
        boolean missing = false;
        for (String p : wanted) {
            if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) missing = true;
        }
        if (missing) {
            try { requestPermissions(wanted, 2002); } catch (Exception e) { }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST && fileChooserCallback != null) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                result = new Uri[]{ data.getData() };
            }
            fileChooserCallback.onReceiveValue(result);
            fileChooserCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    /** True when the URL belongs to the app; false means "open externally". */
    private boolean handleUrl(Uri uri) {
        String url = uri.toString();
        for (String own : OWN_HOSTS) {
            if (url.startsWith(own)) return false;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No app can open that link.", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private void enterFullScreen(View view, WebChromeClient.CustomViewCallback cb) {
        if (customViewCallback != null) {
            cb.onCustomViewHidden();
            return;
        }
        customViewCallback = cb;
        fullScreenView = view;
        view.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        root.addView(view, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void exitFullScreen() {
        if (customViewCallback == null) return;
        customViewCallback.onCustomViewHidden();
        customViewCallback = null;
        if (fullScreenView != null) {
            root.removeView(fullScreenView);
            fullScreenView = null;
        }
        web.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
    }

    /**
     * The page can ask the shell to do the few things a web page genuinely
     * cannot: keep the screen awake, and share a link through the system
     * share sheet.
     */
    private class Bridge {
        @JavascriptInterface
        public void keepAwake(final boolean on) {
            runOnUiThread(new Runnable() {
                public void run() {
                    if (on) {
                        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    } else {
                        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    }
                }
            });
        }

        @JavascriptInterface
        public void share(final String title, final String text) {
            runOnUiThread(new Runnable() {
                public void run() {
                    Intent i = new Intent(Intent.ACTION_SEND);
                    i.setType("text/plain");
                    i.putExtra(Intent.EXTRA_SUBJECT, title == null ? "FirFall" : title);
                    i.putExtra(Intent.EXTRA_TEXT, text == null ? "" : text);
                    startActivity(Intent.createChooser(i, "Share on FirFall"));
                }
            });
        }

        @JavascriptInterface
        public void toast(final String msg) {
            runOnUiThread(new Runnable() {
                public void run() {
                    Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show();
                }
            });
        }
    }

    @Override
    public void onBackPressed() {
        if (fullScreenView != null) {
            exitFullScreen();
            return;
        }
        // Let the page decide first: it knows whether a sheet is open or
        // whether the user is deep in a channel. Only if it declines do we
        // leave the app, and only from the Home tab.
        web.evaluateJavascript(
            "(function(){try{return window.FirFall&&window.FirFall.onBack?window.FirFall.onBack():'exit'}catch(e){return 'exit'}})()",
            new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String value) {
                    // Anything other than an explicit "handled" means the page
                    // could not answer, so leave rather than trapping the user.
                    if (value == null || value.contains("exit")) finish();
                }
            });
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            root.removeView(web);
            web.destroy();
        }
        super.onDestroy();
    }
}
