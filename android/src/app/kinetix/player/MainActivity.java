package app.kinetix.player;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Message;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Locale;

public final class MainActivity extends Activity {
    private static final int FILE_REQUEST = 41;
    private static final String HOME = "#08080C";

    private WebView webView;
    private KinetixServer server;
    private ValueCallback<Uri[]> fileCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Window window = getWindow();
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(Color.parseColor(HOME));
        window.setNavigationBarColor(Color.parseColor(HOME));
        window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor(HOME));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return openExternally(request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return openExternally(Uri.parse(url));
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    startActivityForResult(intent, FILE_REQUEST);
                    return true;
                } catch (Exception error) {
                    fileCallback = null;
                    return false;
                }
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                WebView.HitTestResult hit = view.getHitTestResult();
                String url = hit != null ? hit.getExtra() : null;
                if (url != null) {
                    openExternally(Uri.parse(url));
                    return true;
                }
                return false;
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.deny();
            }
        });

        setContentView(webView);
        webView.addJavascriptInterface(new Bridge(), "kinetixAndroid");
        try {
            server = new KinetixServer(getApplicationContext());
            server.start();
            webView.loadUrl("http://127.0.0.1:" + server.port() + "/?android=1");
        } catch (Exception error) {
            showFatal(error.getMessage() == null ? "Не удалось запустить локальный сервер" : error.getMessage());
        }
    }

    /** Exposed to the web app as window.kinetixAndroid. */
    private final class Bridge {
        @JavascriptInterface
        public boolean saveFile(String name, String mime, String base64) {
            if (base64 == null || base64.isEmpty()) return false;
            byte[] data;
            try {
                data = Base64.decode(base64, Base64.DEFAULT);
            } catch (IllegalArgumentException error) {
                return false;
            }
            if (data.length == 0) return false;
            String fileName = sanitizeName(name);
            String type = mime == null || mime.trim().isEmpty() ? "application/octet-stream" : mime.trim();
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                    ? saveToMediaStore(fileName, type, data)
                    : saveToAppDownloads(fileName, data);
        }
    }

    private String sanitizeName(String name) {
        String value = name == null ? "" : name.trim();
        if (value.isEmpty()) value = "kinetix-file";
        value = value.replaceAll("[^\\p{L}\\p{N}._-]+", "_");
        return value.length() > 120 ? value.substring(value.length() - 120) : value;
    }

    private boolean saveToMediaStore(String name, String mime, byte[] data) {
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Kinetix");
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri target = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (target == null) return false;
            try (OutputStream output = getContentResolver().openOutputStream(target)) {
                if (output == null) return false;
                output.write(data);
            }
            ContentValues ready = new ContentValues();
            ready.put(MediaStore.MediaColumns.IS_PENDING, 0);
            getContentResolver().update(target, ready, null, null);
            return true;
        } catch (Exception error) {
            return false;
        }
    }

    private boolean saveToAppDownloads(String name, byte[] data) {
        try {
            File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (dir == null) dir = getFilesDir();
            if (!dir.exists() && !dir.mkdirs()) return false;
            try (FileOutputStream output = new FileOutputStream(new File(dir, name))) {
                output.write(data);
            }
            return true;
        } catch (Exception error) {
            return false;
        }
    }

    private boolean openExternally(Uri uri) {
        if (uri == null) return true;
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
        if (("http".equals(scheme) || "https".equals(scheme)) && ("127.0.0.1".equals(host) || "localhost".equals(host))) {
            return false;
        }
        if ("about".equals(scheme) || "blob".equals(scheme) || "data".equals(scheme)) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception error) {
            Toast.makeText(this, "Нет приложения для этой ссылки", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private void showFatal(String message) {
        String html = "<!doctype html><html lang=\"ru\"><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
                "<style>body{margin:0;padding:48px 28px;background:#08080c;color:#f4f1e8;font:16px/1.6 -apple-system,sans-serif}" +
                "h1{font-size:28px;letter-spacing:-.02em;margin:0 0 12px}b{color:#d7ff57}p{color:#a7a49c}</style></head><body>" +
                "<h1>Kinetix не запустился.</h1><p>" + message.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;") + "</p>" +
                "<p>Перезапусти приложение. Если ошибка повторяется — переустанови APK.</p></body></html>";
        webView.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_REQUEST) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    ArrayList<Uri> uris = new ArrayList<>();
                    for (int index = 0; index < data.getClipData().getItemCount(); index++) {
                        uris.add(data.getClipData().getItemAt(index).getUri());
                    }
                    result = uris.toArray(new Uri[0]);
                } else if (data.getData() != null) {
                    result = new Uri[]{data.getData()};
                }
            }
            if (fileCallback != null) {
                fileCallback.onReceiveValue(result);
                fileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            finish();
            return;
        }
        webView.evaluateJavascript(
                "(function(){try{return window.__kinetixAndroidBack?window.__kinetixAndroidBack()===true:false}catch(e){return false}})()",
                value -> {
                    if ("true".equals(value)) return;
                    if (webView.canGoBack()) webView.goBack();
                    else finish();
                });
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
        if (server != null) server.stop();
        super.onDestroy();
    }
}
