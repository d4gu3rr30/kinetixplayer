package app.kinetix.player;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/**
 * Minimal YouTube InnerTube client for the VR client, which still hands out
 * direct audio URLs without a cipher or a PoToken.
 */
final class InnerTube {
    private static final String USER_AGENT = "com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12; en_US; Quest 3 Build/SQ3A.220605.009.A1) gzip";
    private static final String CLIENT_NAME = "ANDROID_VR";
    private static final String CLIENT_VERSION = "1.62.27";

    private static final Pattern TIME_STAMP = Pattern.compile("^(\\d{1,2}):(\\d{2})(?::(\\d{2}))?$");
    private static final Pattern DASHED_TITLE = Pattern.compile("^(.{1,60}?)\\s+[-–—]\\s+(.{1,140})$");
    private static final Pattern TITLE_NOISE = Pattern.compile(
            "\\s*[\\[(][^\\])]*(?:official\\s*(?:music\\s*)?(?:video|audio|visualizer|lyric\\s*video)|lyrics?|клип|премьера|premiere|m/?v|audio|visualizer)[^\\])]*[\\])]\\s*$",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    private static final Pattern CATALOG_JUNK = Pattern.compile(
            "интервью|подкаст|podcast|interview|реакци|reaction|обзор|review|full album|альбом|плейлист|сборник|playlist|compilation",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);

    private static final Map<String, CacheEntry> SEARCH_CACHE = new ConcurrentHashMap<>();
    private static final Map<String, CacheEntry> RELATED_CACHE = new ConcurrentHashMap<>();
    private static final Map<String, Stream> STREAMS = new ConcurrentHashMap<>();
    private static volatile String cookieHeader = "";

    private static final class CacheEntry {
        final String json;
        final long expires;

        CacheEntry(String json, long expires) {
            this.json = json;
            this.expires = expires;
        }
    }

    static final class Stream {
        final String url;
        final String mime;
        final long expires;

        Stream(String url, String mime, long expires) {
            this.url = url;
            this.mime = mime;
            this.expires = expires;
        }
    }

    private InnerTube() {
    }

    /** Cookies saved from a signed-in browser; empty means anonymous requests. */
    static void setCookies(String header) {
        cookieHeader = header == null ? "" : header;
        SEARCH_CACHE.clear();
        RELATED_CACHE.clear();
        STREAMS.clear();
    }

    static JSONArray search(String query, int limit, boolean artistMode) throws IOException {
        String key = (artistMode ? "a|" : "t|") + limit + "|" + query.toLowerCase(Locale.ROOT);
        CacheEntry cached = SEARCH_CACHE.get(key);
        if (cached != null && cached.expires > System.currentTimeMillis()) {
            try {
                return new JSONArray(cached.json);
            } catch (JSONException ignored) {
                SEARCH_CACHE.remove(key);
            }
        }
        JSONObject payload = basePayload();
        try {
            payload.put("query", query);
        } catch (JSONException ignored) {
        }
        JSONObject response = post("search", payload);
        List<JSONObject> videos = new ArrayList<>();
        collectVideos(response, videos, new LinkedHashSet<String>());
        JSONArray tracks = toTracks(videos, limit, artistMode);
        if (tracks.length() == 0) {
            throw new IOException("YouTube не вернул результаты поиска");
        }
        store(SEARCH_CACHE, key, tracks.toString(), 5 * 60_000L, 80);
        return tracks;
    }

    static JSONArray related(String videoId, int limit) throws IOException {
        String key = limit + "|" + videoId;
        CacheEntry cached = RELATED_CACHE.get(key);
        if (cached != null && cached.expires > System.currentTimeMillis()) {
            try {
                return new JSONArray(cached.json);
            } catch (JSONException ignored) {
                RELATED_CACHE.remove(key);
            }
        }
        JSONObject payload = basePayload();
        try {
            payload.put("videoId", videoId);
        } catch (JSONException ignored) {
        }
        JSONObject response = post("next", payload);
        List<JSONObject> videos = new ArrayList<>();
        collectVideos(response, videos, new LinkedHashSet<String>());
        JSONArray tracks = toTracks(videos, limit, false);
        store(RELATED_CACHE, key, tracks.toString(), 5 * 60_000L, 80);
        return tracks;
    }

    static void forget(String videoId) {
        STREAMS.remove(videoId);
    }

    static Stream resolve(String videoId) throws IOException {        Stream cached = STREAMS.get(videoId);
        long now = System.currentTimeMillis();
        if (cached != null && cached.expires > now) return cached;
        boolean hasCookies = !cookieHeader.isEmpty();
        JSONObject response;
        String state;
        try {
            response = player(videoId, true);
            state = stateOf(response);
        } catch (IOException error) {
            if (!hasCookies) throw error;
            response = player(videoId, false);
            state = stateOf(response);
        }
        // Stale signed-in cookies make YouTube answer LOGIN_REQUIRED for every
        // track. Anonymous playback is the fallback that keeps the wave alive.
        if (!"OK".equals(state) && hasCookies) {
            try {
                JSONObject fallback = player(videoId, false);
                if ("OK".equals(stateOf(fallback))) {
                    response = fallback;
                    state = "OK";
                }
            } catch (IOException ignored) {
            }
        }
        JSONObject status = response.optJSONObject("playabilityStatus");
        if (!"OK".equals(state)) {
            String reason = status == null ? "" : status.optString("reason", "").trim();
            if ("LOGIN_REQUIRED".equals(state)) {
                throw new IOException("YouTube просит войти в аккаунт для этого трека — включи другой, он заиграет");
            }
            if (reason.isEmpty()) reason = "YouTube не отдал этот трек";
            throw new IOException(reason);
        }
        JSONObject streaming = response.optJSONObject("streamingData");
        if (streaming == null) throw new IOException("YouTube не отдал аудиопоток");
        JSONArray formats = streaming.optJSONArray("adaptiveFormats");
        if (formats == null) formats = streaming.optJSONArray("formats");
        if (formats == null) throw new IOException("YouTube не отдал аудиопоток");

        JSONObject best = null;
        int bestRank = -1;
        for (int index = 0; index < formats.length(); index++) {
            JSONObject format = formats.optJSONObject(index);
            if (format == null) continue;
            String mime = format.optString("mimeType", "");
            if (!mime.startsWith("audio/")) continue;
            String url = format.optString("url", "");
            if (url.isEmpty()) continue;
            int rank = audioRank(format.optInt("itag", 0), mime);
            if (rank > bestRank) {
                bestRank = rank;
                best = format;
            }
        }
        if (best == null) throw new IOException("YouTube не отдал аудиодорожку");

        String url = best.optString("url", "");
        String mime = best.optString("mimeType", "audio/mp4");
        int separator = mime.indexOf(';');
        if (separator > 0) mime = mime.substring(0, separator).trim();
        long expiresIn = 0;
        try {
            expiresIn = Long.parseLong(streaming.optString("expiresInSeconds", "0"));
        } catch (NumberFormatException ignored) {
        }
        long expires = now + Math.max(120_000L, Math.min(expiresIn > 0 ? expiresIn * 1000L : 3 * 60 * 60_000L, 3 * 60 * 60_000L));
        Stream stream = new Stream(url, mime, expires);
        if (STREAMS.size() > 120) STREAMS.clear();
        STREAMS.put(videoId, stream);
        return stream;
    }

    private static int audioRank(int itag, String mime) {
        switch (itag) {
            case 140:
                return 100;
            case 251:
                return 90;
            case 139:
                return 70;
            case 249:
                return 60;
            case 141:
                return 50;
            default:
                if (mime.contains("mp4a")) return 40;
                if (mime.contains("opus")) return 30;
                return 10;
        }
    }

    private static JSONObject basePayload() {
        JSONObject client = new JSONObject();
        JSONObject context = new JSONObject();
        JSONObject payload = new JSONObject();
        try {
            client.put("clientName", CLIENT_NAME);
            client.put("clientVersion", CLIENT_VERSION);
            client.put("androidSdkVersion", 32);
            client.put("deviceMake", "Oculus");
            client.put("deviceModel", "Quest 3");
            client.put("osName", "Android");
            client.put("osVersion", "12");
            client.put("hl", "ru");
            client.put("gl", "US");
            context.put("client", client);
            payload.put("context", context);
        } catch (JSONException ignored) {
        }
        return payload;
    }

    private static JSONObject player(String videoId, boolean withCookies) throws IOException {
        JSONObject payload = basePayload();
        try {
            payload.put("videoId", videoId);
            payload.put("contentCheckOk", true);
            payload.put("racyCheckOk", true);
        } catch (JSONException ignored) {
        }
        return post("player", payload, withCookies);
    }

    private static String stateOf(JSONObject response) {
        JSONObject status = response.optJSONObject("playabilityStatus");
        return status == null ? "" : status.optString("status", "");
    }

    private static final String[] HOSTS = {"www.youtube.com", "youtubei.googleapis.com"};
    private static final int CONNECT_TIMEOUT = 6_000;
    private static final int READ_TIMEOUT = 8_000;

    private static JSONObject post(String endpoint, JSONObject payload) throws IOException {
        return post(endpoint, payload, true);
    }

    private static JSONObject post(String endpoint, JSONObject payload, boolean withCookies) throws IOException {
        byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);
        String path = "/youtubei/v1/" + endpoint + "?prettyPrint=false";
        IOException last = null;
        for (String host : HOSTS) {
            try {
                String text = exchange(host, path, body, withCookies);
                return new JSONObject(text);
            } catch (JSONException error) {
                throw new IOException("YouTube вернул непонятный ответ", error);
            } catch (IOException error) {
                last = error;
            }
        }
        if (last instanceof SocketTimeoutException || (last != null && last.getMessage() != null && last.getMessage().toLowerCase(Locale.ROOT).contains("timed out"))) {
            throw new IOException("YouTube не отвечает — проверьте подключение или включите ВКонтакте и Яндекс Музыку");
        }
        throw last == null ? new IOException("YouTube недоступен") : last;
    }

    private static String exchange(String host, String path, byte[] body, boolean withCookies) throws IOException {
        Socket raw = new Socket();
        SSLSocket tls = null;
        try {
            raw.connect(new InetSocketAddress(host, 443), CONNECT_TIMEOUT);
            raw.setSoTimeout(READ_TIMEOUT);
            tls = (SSLSocket) ((SSLSocketFactory) SSLSocketFactory.getDefault()).createSocket(raw, host, 443, true);
            SSLParameters params = tls.getSSLParameters();
            params.setEndpointIdentificationAlgorithm("HTTPS");
            tls.setSSLParameters(params);
            tls.setSoTimeout(READ_TIMEOUT);
            tls.startHandshake();
            StringBuilder head = new StringBuilder();
            head.append("POST ").append(path).append(" HTTP/1.1\r\n");
            head.append("Host: ").append(host).append("\r\n");
            head.append("Content-Type: application/json; charset=utf-8\r\n");
            head.append("User-Agent: ").append(USER_AGENT).append("\r\n");
            head.append("Accept-Language: ru-RU,ru;q=0.9,en;q=0.8\r\n");
            head.append("Origin: https://www.youtube.com\r\n");
            head.append("X-YouTube-Client-Name: 28\r\n");
            head.append("X-YouTube-Client-Version: ").append(CLIENT_VERSION).append("\r\n");
            String cookies = withCookies ? cookieHeader : "";
            if (!cookies.isEmpty()) {
                head.append("Cookie: ").append(cookies.replace("\r", "").replace("\n", "")).append("\r\n");
                head.append("X-Goog-AuthUser: 0\r\n");
                head.append("X-Origin: https://www.youtube.com\r\n");
            }
            head.append("Content-Length: ").append(body.length).append("\r\n");
            head.append("Connection: close\r\n\r\n");
            OutputStream out = tls.getOutputStream();
            out.write(head.toString().getBytes(StandardCharsets.UTF_8));
            out.write(body);
            out.flush();
            InputStream input = new BufferedInputStream(tls.getInputStream(), 16 * 1024);
            String status = readLine(input);
            if (status == null || !status.startsWith("HTTP/")) throw new IOException("YouTube ответил некорректно");
            int code;
            try {
                code = Integer.parseInt(status.split(" ")[1]);
            } catch (Exception error) {
                throw new IOException("YouTube ответил некорректно", error);
            }
            Map<String, String> headers = new LinkedHashMap<>();
            String line;
            while ((line = readLine(input)) != null && !line.isEmpty()) {
                int colon = line.indexOf(':');
                if (colon > 0) headers.put(line.substring(0, colon).trim().toLowerCase(Locale.ROOT), line.substring(colon + 1).trim());
            }
            String text = new String(readBody(input, headers), StandardCharsets.UTF_8);
            if (code < 200 || code >= 300) {
                throw new IOException("YouTube ответил " + code + (text.isEmpty() ? "" : ": " + shorten(text, 120)));
            }
            return text;
        } finally {
            if (tls != null) try { tls.close(); } catch (IOException ignored) { }
            try { raw.close(); } catch (IOException ignored) { }
        }
    }

    private static String readLine(InputStream input) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        int value;
        while ((value = input.read()) >= 0) {
            if (value == '\n') break;
            if (value != '\r') buffer.write(value);
            if (buffer.size() > 16 * 1024) throw new IOException("YouTube ответил некорректно");
        }
        if (value < 0 && buffer.size() == 0) return null;
        return buffer.toString("UTF-8");
    }

    private static byte[] readBody(InputStream input, Map<String, String> headers) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        String encoding = headers.get("transfer-encoding");
        if (encoding != null && encoding.toLowerCase(Locale.ROOT).contains("chunked")) {
            while (true) {
                String line = readLine(input);
                if (line == null) break;
                int semi = line.indexOf(';');
                String size = (semi >= 0 ? line.substring(0, semi) : line).trim();
                if (size.isEmpty()) continue;
                int length;
                try {
                    length = Integer.parseInt(size, 16);
                } catch (NumberFormatException error) {
                    throw new IOException("YouTube ответил некорректно", error);
                }
                if (length == 0) break;
                buffer.write(readExactly(input, length));
                readLine(input);
                if (buffer.size() > 8 * 1024 * 1024) throw new IOException("YouTube вернул слишком большой ответ");
            }
            return buffer.toByteArray();
        }
        String lengthHeader = headers.get("content-length");
        if (lengthHeader != null) {
            int length;
            try {
                length = Integer.parseInt(lengthHeader);
            } catch (NumberFormatException error) {
                throw new IOException("YouTube ответил некорректно", error);
            }
            buffer.write(readExactly(input, length));
            return buffer.toByteArray();
        }
        byte[] chunk = new byte[16 * 1024];
        int count;
        while ((count = input.read(chunk)) > 0) {
            buffer.write(chunk, 0, count);
            if (buffer.size() > 8 * 1024 * 1024) throw new IOException("YouTube вернул слишком большой ответ");
        }
        return buffer.toByteArray();
    }

    private static byte[] readExactly(InputStream input, int length) throws IOException {
        byte[] data = new byte[length];
        int offset = 0;
        while (offset < length) {
            int count = input.read(data, offset, length - offset);
            if (count < 0) throw new IOException("YouTube оборвал ответ");
            offset += count;
        }
        return data;
    }

    private static String read(InputStream stream) throws IOException {
        if (stream == null) return "";
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[16 * 1024];
        int count;
        while ((count = stream.read(chunk)) > 0) buffer.write(chunk, 0, count);
        stream.close();
        return buffer.toString("UTF-8");
    }

    private static String shorten(String value, int limit) {
        String clean = value.replaceAll("\\s+", " ").trim();
        return clean.length() > limit ? clean.substring(0, limit) + "…" : clean;
    }

    private static void collectVideos(Object node, List<JSONObject> out, Set<String> seen) {
        if (node instanceof JSONObject) {
            JSONObject object = (JSONObject) node;
            JSONObject video = object.optJSONObject("videoRenderer");
            if (video == null) video = object.optJSONObject("compactVideoRenderer");
            if (video != null) {
                String id = video.optString("videoId", "");
                if (id.matches("[\\w-]{11}") && seen.add(id)) out.add(video);
                return;
            }
            JSONArray names = object.names();
            if (names == null) return;
            for (int index = 0; index < names.length(); index++) {
                collectVideos(object.opt(names.optString(index)), out, seen);
            }
        } else if (node instanceof JSONArray) {
            JSONArray array = (JSONArray) node;
            for (int index = 0; index < array.length(); index++) collectVideos(array.opt(index), out, seen);
        }
    }

    private static JSONArray toTracks(List<JSONObject> videos, int limit, boolean artistMode) {
        JSONArray tracks = new JSONArray();
        Set<String> fingerprints = new LinkedHashSet<>();
        for (JSONObject video : videos) {
            if (tracks.length() >= limit) break;
            JSONObject track = trackOf(video, artistMode);
            if (track == null) continue;
            String fingerprint = normalize(track.optString("artist", "")) + "|" + normalize(track.optString("title", ""));
            if (!fingerprints.add(fingerprint)) continue;
            tracks.put(track);
        }
        return tracks;
    }

    private static JSONObject trackOf(JSONObject video, boolean artistMode) {
        String videoId = video.optString("videoId", "");
        if (!videoId.matches("[\\w-]{11}")) return null;
        String rawTitle = textOf(video, "title");
        if (rawTitle.isEmpty()) return null;
        String channel = textOf(video, "longBylineText");
        if (channel.isEmpty()) channel = textOf(video, "shortBylineText");
        if (channel.isEmpty()) channel = textOf(video, "ownerText");
        int duration = parseDuration(textOf(video, "lengthText"));
        if (duration <= 0) return null;
        if (duration < 20 || duration > (artistMode ? 720 : 3600)) return null;

        String cleanedTitle = tidyTitle(rawTitle);
        String artist = cleanChannel(channel);
        String title = cleanedTitle;
        if (!isTopic(channel)) {
            Matcher dashed = DASHED_TITLE.matcher(cleanedTitle);
            if (dashed.matches()) {
                artist = dashed.group(1).trim();
                title = dashed.group(2).trim();
            }
        }
        if (title.isEmpty()) return null;
        if (artistMode && CATALOG_JUNK.matcher(title).find()) return null;
        if (artist.isEmpty()) artist = "YouTube";

        JSONObject track = new JSONObject();
        try {
            track.put("id", "yt:" + videoId);
            track.put("title", title);
            track.put("artist", artist);
            track.put("artwork", "https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg");
            track.put("url", "https://www.youtube.com/watch?v=" + videoId);
            track.put("streamUrl", "/api/yt-stream?v=" + videoId);
            track.put("duration", duration);
            track.put("source", "youtube");
        } catch (JSONException ignored) {
            return null;
        }
        return track;
    }

    private static String textOf(JSONObject object, String key) {
        JSONObject node = object.optJSONObject(key);
        if (node != null) {
            String simple = node.optString("simpleText", "");
            if (!simple.isEmpty()) return simple;
            JSONArray runs = node.optJSONArray("runs");
            if (runs != null) {
                StringBuilder builder = new StringBuilder();
                for (int index = 0; index < runs.length(); index++) {
                    JSONObject run = runs.optJSONObject(index);
                    if (run != null) builder.append(run.optString("text", ""));
                }
                if (builder.length() > 0) return builder.toString();
            }
        }
        return object.optString(key, "");
    }

    private static int parseDuration(String value) {
        Matcher matcher = TIME_STAMP.matcher(value.trim());
        if (!matcher.matches()) return 0;
        int hours = matcher.group(3) != null ? Integer.parseInt(matcher.group(1)) : 0;
        int minutes = matcher.group(3) != null ? Integer.parseInt(matcher.group(2)) : Integer.parseInt(matcher.group(1));
        int seconds = Integer.parseInt(matcher.group(3) != null ? matcher.group(3) : matcher.group(2));
        return hours * 3600 + minutes * 60 + seconds;
    }

    private static boolean isTopic(String channel) {
        return channel != null && channel.toLowerCase(Locale.ROOT).endsWith("- topic");
    }

    private static String cleanChannel(String channel) {
        if (channel == null) return "";
        String value = channel.trim();
        value = value.replaceAll("(?i)\\s*-\\s*topic\\s*$", "");
        value = value.replaceAll("(?i)\\s*vevo\\s*$", "");
        return value.trim();
    }

    private static String tidyTitle(String title) {
        String value = title.trim();
        for (int pass = 0; pass < 3; pass++) {
            Matcher matcher = TITLE_NOISE.matcher(value);
            if (!matcher.find()) break;
            value = matcher.replaceFirst("").trim();
        }
        return value;
    }

    private static String normalize(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]+", " ").trim();
    }

    private static void store(Map<String, CacheEntry> cache, String key, String json, long ttl, int max) {
        if (cache.size() > max) cache.clear();
        cache.put(key, new CacheEntry(json, System.currentTimeMillis() + ttl));
    }

    /** Deezer search used by the artist pages. */
    static JSONObject deezer(String path) throws IOException {
        String target = path.startsWith("/") ? path : "/" + path;
        if (target.contains("://") || target.contains(" ")) throw new IOException("Некорректный запрос");
        URL url = new URL("https://api.deezer.com" + target);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        try {
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(10_000);
            connection.setReadTimeout(15_000);
            connection.setRequestProperty("User-Agent", "Kinetix/1.0 (Android)");
            connection.setRequestProperty("Accept", "application/json");
            int code = connection.getResponseCode();
            InputStream stream = code >= 200 && code < 300 ? connection.getInputStream() : connection.getErrorStream();
            String text = read(stream);
            if (code < 200 || code >= 300) throw new IOException("Deezer ответил " + code);
            JSONObject result = new JSONObject(text);
            if (result.has("error")) {
                JSONObject error = result.optJSONObject("error");
                throw new IOException(error == null ? "Deezer не ответил" : error.optString("message", "Deezer не ответил"));
            }
            return result;
        } catch (JSONException error) {
            throw new IOException("Deezer вернул непонятный ответ", error);
        } finally {
            connection.disconnect();
        }
    }
}
