package app.kinetix.player;

import android.content.Context;
import android.content.res.AssetManager;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Loopback HTTP server that serves the bundled web app and bridges the API
 * endpoints the web client needs. Everything stays inside the app process.
 */
public final class KinetixServer {
    private static final int MAX_BODY = 4 * 1024 * 1024;
    private static final String UA = "Kinetix/1.0 (Android)";
    private static final String BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

    private final Context context;
    private final AssetManager assets;
    private final NativeStore store;
    private final ServerSocket socket;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final Map<String, CachedImage> images = new ConcurrentHashMap<>();
    private volatile boolean running = true;

    private static final class CachedImage {
        final String type;
        final byte[] body;

        CachedImage(String type, byte[] body) {
            this.type = type;
            this.body = body;
        }
    }

    private static final class Request {
        String method = "GET";
        String path = "/";
        Map<String, String> query = new LinkedHashMap<>();
        Map<String, String> headers = new HashMap<>();
        byte[] body = new byte[0];

        String param(String key) {
            String value = query.get(key);
            return value == null ? "" : value;
        }
    }

    KinetixServer(Context context) throws IOException {
        this.context = context.getApplicationContext();
        this.assets = this.context.getAssets();
        this.store = new NativeStore(this.context);
        InnerTube.setCookies(this.store.cookies());
        // localStorage is keyed by origin (host + port), so the port must stay stable between launches.
        InetAddress loopback = InetAddress.getByName("127.0.0.1");
        ServerSocket bound = null;
        IOException failure = null;
        for (int candidate = 47821; candidate <= 47832 && bound == null; candidate++) {
            ServerSocket attempt = new ServerSocket();
            attempt.setReuseAddress(true);
            try {
                attempt.bind(new InetSocketAddress(loopback, candidate));
                bound = attempt;
            } catch (IOException error) {
                failure = error;
                try {
                    attempt.close();
                } catch (IOException ignored) {
                }
            }
        }
        if (bound == null) throw failure == null ? new IOException("Нет свободного локального порта") : failure;
        this.socket = bound;
    }

    int port() {
        return socket.getLocalPort();
    }

    void start() {
        Thread thread = new Thread(() -> {
            while (running) {
                try {
                    Socket client = socket.accept();
                    pool.execute(() -> handle(client));
                } catch (IOException error) {
                    if (running) error.printStackTrace();
                }
            }
        }, "kinetix-http");
        thread.setDaemon(true);
        thread.start();
    }

    void stop() {
        running = false;
        try {
            socket.close();
        } catch (IOException ignored) {
        }
        pool.shutdownNow();
    }

    private void handle(Socket client) {
        try (Socket connection = client) {
            connection.setSoTimeout(20_000);
            InputStream input = new BufferedInputStream(connection.getInputStream(), 16 * 1024);
            OutputStream output = new BufferedOutputStream(connection.getOutputStream(), 16 * 1024);
            Request request = readRequest(input);
            if (request == null) {
                sendText(output, 400, "Некорректный запрос");
                return;
            }
            String host = request.headers.get("host");
            if (host == null || !(host.startsWith("127.0.0.1:") || host.startsWith("localhost:"))) {
                sendText(output, 403, "Недопустимый адрес");
                return;
            }
            try {
                route(request, output);
            } catch (IOException error) {
                sendJson(output, 502, error(error.getMessage() == null ? "Сеть недоступна" : error.getMessage()));
            } catch (Exception error) {
                sendJson(output, 500, error("Внутренняя ошибка сервера"));
            }
            output.flush();
        } catch (Exception ignored) {
        }
    }

    private void route(Request request, OutputStream output) throws IOException, JSONException {
        String path = request.path;
        if (path.equals("/api/config")) {
            sendJson(output, 200, config());
            return;
        }
        if (path.equals("/api/health")) {
            JSONObject data = new JSONObject();
            data.put("ok", true);
            sendJson(output, 200, data);
            return;
        }
        if (path.equals("/api/yt-search")) {
            String query = request.param("q").trim();
            if (query.isEmpty()) {
                sendJson(output, 400, error("Введите запрос"));
                return;
            }
            String source = request.param("source");
            if (source.equals("yandex") || source.equals("vk")) {
                sendJson(output, 400, error("Этот источник недоступен в Android-версии"));
                return;
            }
            int limit = clamp(parseInt(request.param("limit"), 30), 1, 40);
            boolean artistMode = "artist".equals(request.param("mode"));
            JSONArray tracks = InnerTube.search(query.length() > 160 ? query.substring(0, 160) : query, limit, artistMode);
            JSONObject data = new JSONObject();
            data.put("tracks", tracks);
            sendJson(output, 200, data);
            return;
        }
        if (path.equals("/api/yt-related")) {
            String videoId = request.param("v");
            if (!videoId.matches("[\\w-]{11}")) {
                sendJson(output, 400, error("Некорректный трек"));
                return;
            }
            int limit = clamp(parseInt(request.param("limit"), 24), 1, 30);
            JSONObject data = new JSONObject();
            data.put("tracks", InnerTube.related(videoId, limit));
            sendJson(output, 200, data);
            return;
        }
        if (path.equals("/api/yt-warm")) {
            String videoId = request.param("v");
            if (!videoId.matches("[\\w-]{11}")) {
                sendJson(output, 400, error("Некорректный трек"));
                return;
            }
            InnerTube.Stream stream = InnerTube.resolve(videoId);
            JSONObject data = new JSONObject();
            data.put("ok", true);
            data.put("type", stream.mime);
            sendJson(output, 200, data);
            return;
        }
        if (path.equals("/api/yt-stream")) {
            String videoId = request.param("v");
            if (!videoId.matches("[\\w-]{11}")) {
                sendJson(output, 400, error("Некорректный трек"));
                return;
            }
            proxyStream(videoId, request.headers.get("range"), output, true);
            return;
        }
        if (path.equals("/api/integrations")) {
            if ("POST".equalsIgnoreCase(request.method)) saveIntegrations(request, output);
            else sendJson(output, 200, integrations());
            return;
        }
        if (path.equals("/api/youtube-auth")) {
            if ("POST".equalsIgnoreCase(request.method)) saveYouTubeAuth(request, output);
            else if ("DELETE".equalsIgnoreCase(request.method)) clearYouTubeAuth(output);
            else sendJson(output, 200, youtubeStatus());
            return;
        }
        if (path.equals("/api/youtube-auth/test")) {
            testYouTube(output);
            return;
        }
        if (path.equals("/api/vk-search")) {
            String query = request.param("q").trim();
            if (query.isEmpty()) {
                sendJson(output, 400, error("Введите запрос"));
                return;
            }
            String token = store.vk();
            if (token.isEmpty()) {
                sendJson(output, 400, error("Добавьте токен ВКонтакте в настройках"));
                return;
            }
            int limit = clamp(parseInt(request.param("limit"), 30), 1, 50);
            int offset = clamp(parseInt(request.param("offset"), 0), 0, 200);
            boolean artist = "artist".equals(request.param("mode"));
            JSONObject data = new JSONObject();
            data.put("tracks", VkClient.search(token, query.length() > 160 ? query.substring(0, 160) : query, limit, artist, offset));
            sendJson(output, 200, data);
            return;
        }
        if (path.equals("/api/yandex-search")) {
            String query = request.param("q").trim();
            if (query.isEmpty()) {
                sendJson(output, 400, error("Введите запрос"));
                return;
            }
            String token = store.yandex();
            if (token.isEmpty()) {
                sendJson(output, 400, error("Добавьте токен Яндекс Музыки в настройках"));
                return;
            }
            int limit = clamp(parseInt(request.param("limit"), 30), 1, 50);
            JSONObject data = new JSONObject();
            data.put("tracks", YandexClient.search(token, query.length() > 160 ? query.substring(0, 160) : query, limit));
            sendJson(output, 200, data);
            return;
        }
        if (path.equals("/api/vk-stream")) {
            String id = request.param("id");
            if (!id.matches("(?:vk:)?-?\\d+_\\d+")) {
                sendJson(output, 400, error("Некорректный трек"));
                return;
            }
            String token = store.vk();
            if (token.isEmpty()) {
                sendJson(output, 400, error("Добавьте токен ВКонтакте в настройках"));
                return;
            }
            VkClient.Stream stream = VkClient.resolve(token, id);
            proxyRemote(stream.url, "audio/mpeg", request.headers.get("range"), output, BROWSER_UA, () -> {
                VkClient.forget(id);
                return VkClient.resolve(token, id).url;
            });
            return;
        }
        if (path.equals("/api/yandex-stream")) {
            String id = request.param("id");
            if (!id.matches("\\d{1,20}")) {
                sendJson(output, 400, error("Некорректный трек"));
                return;
            }
            String token = store.yandex();
            if (token.isEmpty()) {
                sendJson(output, 400, error("Добавьте токен Яндекс Музыки в настройках"));
                return;
            }
            YandexClient.Stream stream = YandexClient.resolve(token, id);
            proxyRemote(stream.url, stream.type, request.headers.get("range"), output, BROWSER_UA, () -> {
                YandexClient.forget(id);
                return YandexClient.resolve(token, id).url;
            });
            return;
        }
        if (path.equals("/api/artist-photo")) {
            artistPhoto(request.param("name").trim(), output);
            return;
        }
        if (path.equals("/__native/deezer")) {
            String target = request.param("path");
            sendJson(output, 200, InnerTube.deezer(target));
            return;
        }
        if (path.startsWith("/api/") || path.startsWith("/__native/")) {
            sendJson(output, 404, error("Недоступно в Android-версии"));
            return;
        }
        staticFile(path, output);
    }

    private JSONObject config() throws JSONException {
        JSONObject data = new JSONObject();
        boolean vk = !store.vk().isEmpty();
        boolean yandex = !store.yandex().isEmpty();
        data.put("ready", true);
        data.put("android", true);
        data.put("soundcloud", false);
        data.put("archive", true);
        data.put("youtube", true);
        data.put("youtubeDl", true);
        data.put("yandex", true);
        data.put("yandexFull", yandex);
        data.put("vk", vk);
        data.put("vkIssue", "");
        data.put("offline", false);
        data.put("desktop", false);
        data.put("googleClientId", "");
        data.put("googleSecret", false);
        return data;
    }

    private JSONObject tokenStatus(String value) throws JSONException {
        JSONObject status = new JSONObject();
        status.put("set", value != null && !value.isEmpty());
        status.put("length", value == null ? 0 : value.length());
        return status;
    }

    private JSONObject integrations() throws JSONException {
        JSONObject data = new JSONObject();
        data.put("vk", tokenStatus(store.vk()));
        data.put("yandex", tokenStatus(store.yandex()));
        data.put("google", tokenStatus(""));
        data.put("googleSecret", tokenStatus(""));
        return data;
    }

    private JSONObject youtubeStatus() throws JSONException {
        JSONObject data = new JSONObject();
        boolean on = store.hasCookies();
        data.put("mode", on ? "file" : "off");
        data.put("browser", "");
        data.put("cookieCount", store.cookieCount());
        data.put("updatedAt", store.cookieUpdated());
        data.put("ytDlp", true);
        data.put("usingEnv", false);
        return data;
    }

    private JSONObject body(Request request) {
        if (request.body.length == 0) return null;
        try {
            return new JSONObject(new String(request.body, StandardCharsets.UTF_8));
        } catch (JSONException error) {
            return null;
        }
    }

    private void saveIntegrations(Request request, OutputStream output) throws IOException, JSONException {
        JSONObject payload = body(request);
        if (payload == null) {
            sendJson(output, 400, error("Некорректный запрос"));
            return;
        }
        for (String name : new String[]{"vk", "yandex"}) {
            if (!payload.has(name) || payload.isNull(name)) continue;
            String value = payload.optString(name, "").trim();
            if (value.length() > 4096) {
                sendJson(output, 400, error("Токен слишком длинный"));
                return;
            }
            store.setToken(name, value);
        }
        sendJson(output, 200, integrations());
    }

    private void saveYouTubeAuth(Request request, OutputStream output) throws IOException, JSONException {
        JSONObject payload = body(request);
        if (payload == null) {
            sendJson(output, 400, error("Некорректный запрос"));
            return;
        }
        String mode = payload.optString("mode", "file");
        if ("off".equals(mode)) {
            store.clearCookies();
            InnerTube.setCookies("");
            sendJson(output, 200, youtubeStatus());
            return;
        }
        if ("browser".equals(mode)) {
            sendJson(output, 400, error("На Android cookies можно только вставить файлом"));
            return;
        }
        Cookies.Parsed parsed = Cookies.parse(payload.optString("cookies", ""));
        if (parsed == null) {
            sendJson(output, 400, error("В cookies не нашлось данных YouTube. Нужен cookies.txt (Netscape) или JSON-экспорт целиком"));
            return;
        }
        store.saveCookies(parsed.header, parsed.count);
        InnerTube.setCookies(parsed.header);
        sendJson(output, 200, youtubeStatus());
    }

    private void clearYouTubeAuth(OutputStream output) throws IOException, JSONException {
        store.clearCookies();
        InnerTube.setCookies("");
        sendJson(output, 200, youtubeStatus());
    }

    private void testYouTube(OutputStream output) throws IOException, JSONException {
        JSONObject data = new JSONObject();
        try {
            JSONArray tracks = InnerTube.search("music", 1, false);
            JSONObject track = tracks.optJSONObject(0);
            data.put("ok", true);
            data.put("title", track == null ? "" : track.optString("title", ""));
        } catch (Exception error) {
            data.put("ok", false);
            data.put("error", error.getMessage() == null ? "YouTube не ответил" : error.getMessage());
        }
        sendJson(output, 200, data);
    }

    private interface StreamRefresher {
        String refresh() throws IOException;
    }

    private void proxyRemote(String url, String fallbackType, String range, OutputStream output, String userAgent, StreamRefresher refresher) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        try {
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(35_000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("User-Agent", userAgent);
            connection.setRequestProperty("Accept", "*/*");
            if (range != null && !range.isEmpty()) connection.setRequestProperty("Range", range);
            int code = connection.getResponseCode();
            if ((code == 403 || code == 404 || code == 410) && refresher != null) {
                try {
                    connection.disconnect();
                } catch (Exception ignored) {
                }
                proxyRemote(refresher.refresh(), fallbackType, range, output, userAgent, null);
                return;
            }
            if (code != 200 && code != 206) {
                String detail = readText(connection.getErrorStream());
                sendJson(output, 502, error("Источник не отдал поток (" + code + ") " + shorten(detail, 80)));
                return;
            }
            String type = connection.getContentType();
            if (type == null || type.isEmpty()) type = fallbackType;
            long length = connection.getContentLengthLong();
            String contentRange = connection.getHeaderField("Content-Range");
            StringBuilder head = new StringBuilder();
            head.append("HTTP/1.1 ").append(code).append(' ').append(statusText(code)).append("\r\n");
            head.append("Content-Type: ").append(type).append("\r\n");
            if (length >= 0) head.append("Content-Length: ").append(length).append("\r\n");
            if (contentRange != null) head.append("Content-Range: ").append(contentRange).append("\r\n");
            head.append("Accept-Ranges: bytes\r\n");
            head.append("Cache-Control: private, max-age=3600\r\n");
            head.append("Connection: close\r\n\r\n");
            output.write(head.toString().getBytes(StandardCharsets.UTF_8));
            try (InputStream body = connection.getInputStream()) {
                copy(body, output);
            } catch (IOException ignored) {
                // The player cancelled or seeked: the response is already committed.
            }
        } finally {
            connection.disconnect();
        }
    }

    private void proxyStream(String videoId, String range, OutputStream output, boolean retry) throws IOException {
        InnerTube.Stream stream = InnerTube.resolve(videoId);
        HttpURLConnection connection = (HttpURLConnection) new URL(stream.url).openConnection();
        try {
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(35_000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("User-Agent", UA);
            connection.setRequestProperty("Accept", "*/*");
            if (range != null && !range.isEmpty()) connection.setRequestProperty("Range", range);
            int code = connection.getResponseCode();
            if ((code == 403 || code == 410) && retry) {
                InnerTube.forget(videoId);
                proxyStream(videoId, range, output, false);
                return;
            }
            if (code != 200 && code != 206) {
                String detail = readText(connection.getErrorStream());
                sendJson(output, 502, error("YouTube не отдал поток (" + code + ") " + shorten(detail, 80)));
                return;
            }
            String type = connection.getContentType();
            if (type == null || type.isEmpty()) type = stream.mime;
            long length = connection.getContentLengthLong();
            String contentRange = connection.getHeaderField("Content-Range");
            StringBuilder head = new StringBuilder();
            head.append("HTTP/1.1 ").append(code).append(' ').append(statusText(code)).append("\r\n");
            head.append("Content-Type: ").append(type).append("\r\n");
            if (length >= 0) head.append("Content-Length: ").append(length).append("\r\n");
            if (contentRange != null) head.append("Content-Range: ").append(contentRange).append("\r\n");
            head.append("Accept-Ranges: bytes\r\n");
            head.append("Cache-Control: private, max-age=3600\r\n");
            head.append("Connection: close\r\n\r\n");
            output.write(head.toString().getBytes(StandardCharsets.UTF_8));
            try (InputStream body = connection.getInputStream()) {
                copy(body, output);
            } catch (IOException ignored) {
                // The player cancelled or seeked: the response is already committed.
            }
        } finally {
            connection.disconnect();
        }
    }

    private void artistPhoto(String name, OutputStream output) throws IOException {
        if (name.isEmpty()) {
            sendJson(output, 400, error("Укажите исполнителя"));
            return;
        }
        String key = name.toLowerCase(Locale.ROOT);
        CachedImage cached = images.get(key);
        if (cached != null) {
            sendBytes(output, 200, cached.type, cached.body, "public, max-age=604800");
            return;
        }
        try {
            JSONObject result = InnerTube.deezer("/search/artist?q=" + encode(name) + "&limit=1");
            JSONArray data = result.optJSONArray("data");
            if (data != null && data.length() > 0) {
                JSONObject artist = data.optJSONObject(0);
                String url = artist == null ? "" : artist.optString("picture_xl", "");
                if (url.isEmpty() && artist != null) url = artist.optString("picture_big", "");
                if (url.isEmpty() && artist != null) url = artist.optString("picture_medium", "");
                if (!url.isEmpty()) {
                    CachedImage image = downloadImage(url);
                    if (image != null) {
                        if (images.size() > 240) images.clear();
                        images.put(key, image);
                        sendBytes(output, 200, image.type, image.body, "public, max-age=604800");
                        return;
                    }
                }
            }
        } catch (Exception ignored) {
        }
        byte[] placeholder = placeholder(name).getBytes(StandardCharsets.UTF_8);
        sendBytes(output, 200, "image/svg+xml; charset=utf-8", placeholder, "public, max-age=86400");
    }

    private CachedImage downloadImage(String url) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        try {
            connection.setConnectTimeout(10_000);
            connection.setReadTimeout(15_000);
            connection.setRequestProperty("User-Agent", UA);
            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) return null;
            String type = connection.getContentType();
            if (type == null || !type.startsWith("image/")) return null;
            byte[] body = readBytes(connection.getInputStream(), 3_000_000);
            if (body.length == 0) return null;
            return new CachedImage(type, body);
        } finally {
            connection.disconnect();
        }
    }

    private void staticFile(String rawPath, OutputStream output) throws IOException {
        String path = decodePath(rawPath);
        if (path == null || path.contains("..") || path.contains("\\")) {
            sendText(output, 404, "Не найдено");
            return;
        }
        if (path.equals("/")) path = "/index.html";
        if (path.endsWith("/")) path += "index.html";
        String asset = "www" + path;
        try {
            InputStream input = assets.open(asset);
            byte[] body = readBytes(input, 32 * 1024 * 1024);
            String type = mime(path);
            String cache = path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
            sendBytes(output, 200, type, body, cache);
        } catch (FileNotFoundException error) {
            if (!path.substring(path.lastIndexOf('/')).contains(".")) {
                try {
                    byte[] body = readBytes(assets.open("www/index.html"), 8 * 1024 * 1024);
                    sendBytes(output, 200, "text/html; charset=utf-8", body, "no-cache");
                    return;
                } catch (IOException ignored) {
                }
            }
            sendText(output, 404, "Не найдено");
        }
    }

    private String mime(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        int dot = lower.lastIndexOf('.');
        String extension = dot < 0 ? "" : lower.substring(dot + 1);
        switch (extension) {
            case "html":
                return "text/html; charset=utf-8";
            case "js":
            case "mjs":
                return "text/javascript; charset=utf-8";
            case "css":
                return "text/css; charset=utf-8";
            case "json":
                return "application/json; charset=utf-8";
            case "svg":
                return "image/svg+xml";
            case "png":
                return "image/png";
            case "jpg":
            case "jpeg":
                return "image/jpeg";
            case "webp":
                return "image/webp";
            case "ico":
                return "image/x-icon";
            case "woff":
                return "font/woff";
            case "woff2":
                return "font/woff2";
            case "ttf":
                return "font/ttf";
            case "mp3":
                return "audio/mpeg";
            case "m4a":
                return "audio/mp4";
            case "ogg":
                return "audio/ogg";
            case "wav":
                return "audio/wav";
            case "wasm":
                return "application/wasm";
            case "map":
                return "application/json";
            default:
                return "application/octet-stream";
        }
    }

    private Request readRequest(InputStream input) throws IOException {
        String line = readLine(input, 8192);
        if (line == null || line.isEmpty()) return null;
        String[] parts = line.split(" ");
        if (parts.length < 2) return null;
        Request request = new Request();
        request.method = parts[0].toUpperCase(Locale.ROOT);
        String target = parts[1];
        int queryAt = target.indexOf('?');
        request.path = queryAt >= 0 ? target.substring(0, queryAt) : target;
        if (queryAt >= 0) {
            for (String pair : target.substring(queryAt + 1).split("&")) {
                if (pair.isEmpty()) continue;
                int equals = pair.indexOf('=');
                String key = equals < 0 ? pair : pair.substring(0, equals);
                String value = equals < 0 ? "" : pair.substring(equals + 1);
                request.query.put(decodeComponent(key), decodeComponent(value));
            }
        }
        int headerCount = 0;
        while ((line = readLine(input, 16384)) != null) {
            if (line.isEmpty()) break;
            if (++headerCount > 80) return null;
            int colon = line.indexOf(':');
            if (colon <= 0) continue;
            request.headers.put(line.substring(0, colon).trim().toLowerCase(Locale.ROOT), line.substring(colon + 1).trim());
        }
        int length = parseInt(request.headers.get("content-length"), 0);
        if (length > MAX_BODY) throw new IOException("Слишком большой запрос");
        if (length > 0) request.body = readFixed(input, length);
        return request;
    }

    private static byte[] readFixed(InputStream input, int length) throws IOException {
        byte[] data = new byte[length];
        int offset = 0;
        while (offset < length) {
            int count = input.read(data, offset, length - offset);
            if (count < 0) throw new IOException("Запрос оборвался");
            offset += count;
        }
        return data;
    }

    private String readLine(InputStream input, int limit) throws IOException {
        ByteArrayOutputStream line = new ByteArrayOutputStream();
        int value;
        while ((value = input.read()) >= 0) {
            if (value == '\n') break;
            if (value != '\r') line.write(value);
            if (line.size() > limit) return null;
        }
        if (value < 0 && line.size() == 0) return null;
        return new String(line.toByteArray(), StandardCharsets.ISO_8859_1);
    }

    private static String decodePath(String path) {
        return decodeComponent(path);
    }

    private static String decodeComponent(String value) {
        try {
            return URLDecoder.decode(value, "UTF-8").replace('\u0000', ' ');
        } catch (Exception error) {
            return value;
        }
    }

    private static String encode(String value) {
        try {
            return URLEncoder.encode(value, "UTF-8");
        } catch (Exception error) {
            return value;
        }
    }

    private void sendJson(OutputStream output, int status, JSONObject data) throws IOException {
        sendBytes(output, status, "application/json; charset=utf-8", data.toString().getBytes(StandardCharsets.UTF_8), "no-store");
    }

    private void sendText(OutputStream output, int status, String text) throws IOException {
        sendBytes(output, status, "text/plain; charset=utf-8", text.getBytes(StandardCharsets.UTF_8), "no-store");
    }

    private void sendBytes(OutputStream output, int status, String type, byte[] body, String cache) throws IOException {
        String head = "HTTP/1.1 " + status + " " + statusText(status) + "\r\n" +
                "Content-Type: " + type + "\r\n" +
                "Content-Length: " + body.length + "\r\n" +
                "Cache-Control: " + cache + "\r\n" +
                "Connection: close\r\n\r\n";
        output.write(head.getBytes(StandardCharsets.UTF_8));
        output.write(body);
        output.flush();
    }

    private static String statusText(int status) {
        switch (status) {
            case 200:
                return "OK";
            case 206:
                return "Partial Content";
            case 400:
                return "Bad Request";
            case 403:
                return "Forbidden";
            case 404:
                return "Not Found";
            case 502:
                return "Bad Gateway";
            default:
                return "Error";
        }
    }

    private static JSONObject error(String message) {
        JSONObject data = new JSONObject();
        try {
            data.put("error", message);
        } catch (JSONException ignored) {
        }
        return data;
    }

    private static String placeholder(String name) {
        String initials = name.trim().isEmpty() ? "K" : name.trim().substring(0, 1).toUpperCase(Locale.ROOT);
        String safe = initials.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
        return "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"500\" height=\"500\" viewBox=\"0 0 500 500\">" +
                "<defs><linearGradient id=\"g\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#2a3b1f\"/><stop offset=\"1\" stop-color=\"#11151c\"/></linearGradient></defs>" +
                "<rect width=\"500\" height=\"500\" fill=\"url(#g)\"/><text x=\"250\" y=\"290\" font-family=\"sans-serif\" font-size=\"190\" font-weight=\"700\" fill=\"#d7ff57\" text-anchor=\"middle\">" + safe + "</text></svg>";
    }

    private static int parseInt(String value, int fallback) {
        try {
            return Integer.parseInt(value == null ? "" : value.trim());
        } catch (NumberFormatException error) {
            return fallback;
        }
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    private static String shorten(String value, int limit) {
        String clean = value == null ? "" : value.replaceAll("\\s+", " ").trim();
        return clean.length() > limit ? clean.substring(0, limit) + "…" : clean;
    }

    private static String readText(InputStream stream) {
        if (stream == null) return "";
        try {
            return new String(readBytes(stream, 200_000), StandardCharsets.UTF_8);
        } catch (IOException error) {
            return "";
        }
    }

    private static byte[] readBytes(InputStream stream, int limit) throws IOException {
        try (InputStream input = stream) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[32 * 1024];
            int count;
            while ((count = input.read(chunk)) > 0) {
                buffer.write(chunk, 0, count);
                if (buffer.size() > limit) throw new IOException("Ответ слишком большой");
            }
            return buffer.toByteArray();
        }
    }

    private static void copy(InputStream input, OutputStream output) throws IOException {
        byte[] chunk = new byte[32 * 1024];
        int count;
        while ((count = input.read(chunk)) > 0) output.write(chunk, 0, count);
    }
}
