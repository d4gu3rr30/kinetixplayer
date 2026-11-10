package app.kinetix.player;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Yandex Music client: search and signed MP3 streams. */
final class YandexClient {
    private static final String API = "https://api.music.yandex.net";
    private static final String USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
    private static final Pattern TRACK_ID = Pattern.compile("^\\d{1,20}$");
    private static final Pattern XML_TAG = Pattern.compile("<%s>(.*?)</%s>", Pattern.DOTALL);
    private static final Map<String, Stream> STREAMS = new ConcurrentHashMap<>();

    static final class Stream {
        final String url;
        final String type;
        final long expires;

        Stream(String url, String type, long expires) {
            this.url = url;
            this.type = type;
            this.expires = expires;
        }
    }

    private YandexClient() {
    }

    static JSONArray search(String token, String rawQuery, int limit) throws IOException {
        String query = rawQuery == null ? "" : rawQuery.trim();
        if (query.isEmpty()) throw new IOException("Введите запрос");
        String target = API + "/search?text=" + enc(query) + "&type=track&page=0&nocorrect=false";
        JSONObject data = request(target, token);
        JSONObject result = data.optJSONObject("result");
        JSONObject tracksNode = result == null ? null : result.optJSONObject("tracks");
        JSONArray results = tracksNode == null ? null : tracksNode.optJSONArray("results");
        JSONArray tracks = new JSONArray();
        if (results == null) return tracks;
        for (int index = 0; index < results.length() && tracks.length() < limit; index++) {
            JSONObject track = trackOf(results.optJSONObject(index));
            if (track != null) tracks.put(track);
        }
        return tracks;
    }

    static Stream resolve(String token, String trackId) throws IOException {
        if (trackId == null || !TRACK_ID.matcher(trackId.trim()).matches()) throw new IOException("Некорректный идентификатор трека Яндекс Музыки");
        String id = trackId.trim();
        Stream cached = STREAMS.get(id);
        if (cached != null && cached.expires > System.currentTimeMillis()) return cached;
        if (token == null || token.isEmpty()) throw new IOException("Добавьте токен Яндекс Музыки в настройках");
        JSONObject info = request(API + "/tracks/" + id + "/download-info", token);
        JSONArray raw = info.optJSONArray("result");
        List<JSONObject> options = new ArrayList<>();
        if (raw != null) {
            for (int index = 0; index < raw.length(); index++) {
                JSONObject option = raw.optJSONObject(index);
                if (option != null && !option.optString("downloadInfoUrl", "").isEmpty()) options.add(option);
            }
        }
        options.sort((left, right) -> {
            boolean leftMp3 = "mp3".equalsIgnoreCase(left.optString("codec", ""));
            boolean rightMp3 = "mp3".equalsIgnoreCase(right.optString("codec", ""));
            if (leftMp3 != rightMp3) return leftMp3 ? -1 : 1;
            return right.optInt("bitrateInKbps", 0) - left.optInt("bitrateInKbps", 0);
        });
        if (options.isEmpty()) throw new IOException("Трек недоступен в Яндекс Музыке");
        JSONObject option = options.get(0);
        String xml = fetchText(option.optString("downloadInfoUrl", ""), "");
        String host = tag(xml, "host");
        String path = tag(xml, "path");
        String timestamp = tag(xml, "ts");
        String salt = tag(xml, "s");
        if (host.isEmpty() || path.isEmpty() || timestamp.isEmpty() || salt.isEmpty()) {
            throw new IOException("Не удалось подписать поток Яндекс Музыки");
        }
        String signature = md5(salt + path);
        String type = "aac".equalsIgnoreCase(option.optString("codec", "")) ? "audio/mp4" : "audio/mpeg";
        Stream stream = new Stream("https://" + host + "/get-mp3/" + signature + "/" + timestamp + path, type, System.currentTimeMillis() + 25 * 60_000L);
        if (STREAMS.size() > 100) STREAMS.clear();
        STREAMS.put(id, stream);
        return stream;
    }

    static void forget(String trackId) {
        if (trackId != null) STREAMS.remove(trackId.trim());
    }

    private static JSONObject trackOf(JSONObject item) {
        if (item == null) return null;
        if (item.has("available") && !item.optBoolean("available", true)) return null;
        String id = item.optString("id", "");
        String title = item.optString("title", "").trim();
        if (!TRACK_ID.matcher(id).matches() || title.isEmpty()) return null;
        StringBuilder artist = new StringBuilder();
        JSONArray artists = item.optJSONArray("artists");
        if (artists != null) {
            for (int index = 0; index < artists.length(); index++) {
                JSONObject performer = artists.optJSONObject(index);
                String name = performer == null ? "" : performer.optString("name", "").trim();
                if (name.isEmpty()) continue;
                if (artist.length() > 0) artist.append(", ");
                artist.append(name);
            }
        }
        String cover = item.optString("coverUri", "");
        if (cover.isEmpty()) {
            JSONArray albums = item.optJSONArray("albums");
            JSONObject album = albums == null ? null : albums.optJSONObject(0);
            if (album != null) cover = album.optString("coverUri", "");
        }
        long durationMs = item.optLong("durationMs", 0L);
        try {
            JSONObject track = new JSONObject();
            track.put("id", "yandex:" + id);
            track.put("title", title);
            track.put("artist", artist.length() == 0 ? "Яндекс Музыка" : artist.toString());
            if (!cover.isEmpty()) track.put("artwork", "https://" + cover.replace("%%", "400x400"));
            track.put("url", "https://music.yandex.ru/track/" + id);
            track.put("streamUrl", "/api/yandex-stream?id=" + id);
            if (durationMs > 0) track.put("duration", durationMs / 1000.0);
            track.put("source", "yandex");
            return track;
        } catch (JSONException ignored) {
            return null;
        }
    }

    private static JSONObject request(String url, String token) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        try {
            connection.setConnectTimeout(12_000);
            connection.setReadTimeout(15_000);
            connection.setRequestProperty("User-Agent", USER_AGENT);
            connection.setRequestProperty("Accept", "application/json");
            if (token != null && !token.isEmpty()) connection.setRequestProperty("Authorization", "OAuth " + token);
            int code = connection.getResponseCode();
            String text = read(code >= 200 && code < 300 ? connection.getInputStream() : connection.getErrorStream());
            if (code == 401 || code == 403) throw new IOException("Яндекс Музыка не приняла токен — проверьте его в настройках");
            if (code < 200 || code >= 300) throw new IOException("Яндекс Музыка недоступна (" + code + ")");
            return new JSONObject(text);
        } catch (JSONException error) {
            throw new IOException("Яндекс Музыка вернула непонятный ответ", error);
        } finally {
            connection.disconnect();
        }
    }

    private static String fetchText(String url, String token) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        try {
            connection.setConnectTimeout(12_000);
            connection.setReadTimeout(15_000);
            connection.setRequestProperty("User-Agent", USER_AGENT);
            if (token != null && !token.isEmpty()) connection.setRequestProperty("Authorization", "OAuth " + token);
            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) throw new IOException("Не удалось получить ссылку на поток Яндекс Музыки");
            return read(connection.getInputStream());
        } finally {
            connection.disconnect();
        }
    }

    private static String tag(String xml, String name) {
        Matcher matcher = Pattern.compile(String.format(Locale.ROOT, XML_TAG.pattern(), name, name), Pattern.DOTALL).matcher(xml);
        if (!matcher.find()) return "";
        String value = matcher.group(1).trim();
        return value.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&");
    }

    private static String md5(String value) throws IOException {
        try {
            byte[] digest = MessageDigest.getInstance("MD5").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte item : digest) hex.append(String.format(Locale.ROOT, "%02x", item & 0xff));
            return hex.toString();
        } catch (Exception error) {
            throw new IOException("Не удалось подписать поток Яндекс Музыки", error);
        }
    }

    private static String read(InputStream stream) throws IOException {
        if (stream == null) return "";
        try (InputStream input = stream) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[16 * 1024];
            int count;
            while ((count = input.read(chunk)) > 0) buffer.write(chunk, 0, count);
            return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private static String enc(String value) {
        try {
            return URLEncoder.encode(value == null ? "" : value, "UTF-8");
        } catch (Exception error) {
            return "";
        }
    }
}
