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
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Minimal VK audio client: search, stream lookup and signed URL refresh. */
final class VkClient {
    private static final String API = "https://api.vk.com/method";
    private static final String USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
    private static final Pattern AUDIO_HOST = Pattern.compile("(^|\\.)(userapi\\.com|vkuseraudio\\.net|vk-cdn\\.net|mycdn\\.me|vk\\.com)$", Pattern.CASE_INSENSITIVE);
    private static final Pattern TRACK_ID = Pattern.compile("^(?:vk:)?(-?\\d+)_(\\d+)$");
    private static final Pattern EXPIRES = Pattern.compile("[?&]expires=(\\d+)");
    private static final Map<String, Stream> STREAMS = new ConcurrentHashMap<>();

    static final class Stream {
        final String url;
        final long expires;

        Stream(String url, long expires) {
            this.url = url;
            this.expires = expires;
        }
    }

    private VkClient() {
    }

    static JSONArray search(String token, String rawQuery, int limit, boolean artist, int offset) throws IOException {
        String query = rawQuery == null ? "" : rawQuery.trim();
        if (query.isEmpty()) throw new IOException("Введите запрос");
        StringBuilder target = new StringBuilder(API)
                .append("/audio.search?access_token=").append(enc(token))
                .append("&v=5.95&q=").append(enc(query))
                .append("&count=").append(Math.max(1, Math.min(limit, 50)));
        if (offset > 0) target.append("&offset=").append(offset);
        if (artist) target.append("&performer_only=1");
        JSONObject data = call(target.toString());
        JSONObject response = data.optJSONObject("response");
        JSONArray items = response == null ? data.optJSONArray("response") : response.optJSONArray("items");
        JSONArray tracks = new JSONArray();
        if (items == null) return tracks;
        for (int index = 0; index < items.length(); index++) {
            JSONObject track = trackOf(items.optJSONObject(index));
            if (track != null) tracks.put(track);
        }
        return tracks;
    }

    static Stream resolve(String token, String rawId) throws IOException {
        Matcher matcher = TRACK_ID.matcher(rawId == null ? "" : rawId.trim());
        if (!matcher.matches()) throw new IOException("Некорректный идентификатор трека ВКонтакте");
        String audioId = matcher.group(1) + "_" + matcher.group(2);
        Stream cached = STREAMS.get(audioId);
        if (cached != null && cached.expires > System.currentTimeMillis()) return cached;
        String target = API + "/audio.getById?access_token=" + enc(token) + "&v=5.95&audios=" + enc(audioId);
        JSONObject data = call(target);
        JSONObject response = data.optJSONObject("response");
        JSONArray items = response == null ? data.optJSONArray("response") : response.optJSONArray("items");
        JSONObject item = items == null ? null : items.optJSONObject(0);
        String url = item == null ? "" : item.optString("url", "");
        if (url.isEmpty()) throw new IOException("ВКонтакте не отдал аудиопоток — трек удалён или скрыт");
        if (!hostAllowed(url)) throw new IOException("ВКонтакте вернул небезопасную ссылку на поток");
        long expires = System.currentTimeMillis() + 30 * 60_000L;
        Matcher signed = EXPIRES.matcher(url);
        if (signed.find()) {
            try {
                long value = Long.parseLong(signed.group(1));
                if (value > 0) expires = Math.min(expires, value * 1000L - 60_000L);
            } catch (NumberFormatException ignored) {
            }
        }
        Stream stream = new Stream(url, expires);
        if (STREAMS.size() > 80) STREAMS.clear();
        STREAMS.put(audioId, stream);
        return stream;
    }

    static void forget(String rawId) {
        Matcher matcher = TRACK_ID.matcher(rawId == null ? "" : rawId.trim());
        if (matcher.matches()) STREAMS.remove(matcher.group(1) + "_" + matcher.group(2));
    }

    private static JSONObject trackOf(JSONObject item) {
        if (item == null) return null;
        String url = item.optString("url", "");
        long id = item.optLong("id", 0L);
        long owner = item.optLong("owner_id", 0L);
        String title = item.optString("title", "").trim();
        if (url.isEmpty() || id == 0L || owner == 0L || title.isEmpty()) return null;
        if (!hostAllowed(url)) return null;
        String artist = item.optString("artist", "").trim();
        String artwork = "";
        JSONObject album = item.optJSONObject("album");
        JSONObject thumb = album == null ? null : album.optJSONObject("thumb");
        if (thumb != null) {
            artwork = thumb.optString("photo_600", thumb.optString("photo_270", ""));
        }
        try {
            JSONObject track = new JSONObject();
            track.put("id", "vk:" + owner + "_" + id);
            track.put("title", title);
            track.put("artist", artist.isEmpty() ? "ВКонтакте" : artist);
            if (!artwork.isEmpty()) track.put("artwork", artwork);
            track.put("url", "https://vk.com/audio" + owner + "_" + id);
            track.put("streamUrl", "/api/vk-stream?id=" + enc(owner + "_" + id));
            long duration = item.optLong("duration", 0L);
            if (duration > 0) track.put("duration", duration);
            track.put("source", "vk");
            return track;
        } catch (JSONException ignored) {
            return null;
        }
    }

    private static JSONObject call(String url) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        try {
            connection.setConnectTimeout(12_000);
            connection.setReadTimeout(15_000);
            connection.setRequestProperty("User-Agent", USER_AGENT);
            connection.setRequestProperty("Accept", "application/json");
            int code = connection.getResponseCode();
            String text = read(code >= 200 && code < 300 ? connection.getInputStream() : connection.getErrorStream());
            if (code < 200 || code >= 300) throw new IOException("ВКонтакте ответил " + code);
            JSONObject data = new JSONObject(text);
            if (data.has("error")) {
                JSONObject error = data.optJSONObject("error");
                String message = error == null ? "" : error.optString("error_msg", "").trim();
                if (message.toLowerCase(Locale.ROOT).matches(".*(access_token.*(expired|invalid)|user authorization failed|authorization failed).*")) {
                    throw new IOException("Токен ВКонтакте не принят — обновите его в настройках");
                }
                throw new IOException(message.isEmpty() ? "ВКонтакте отклонил запрос" : message);
            }
            return data;
        } catch (JSONException error) {
            throw new IOException("ВКонтакте вернул непонятный ответ", error);
        } finally {
            connection.disconnect();
        }
    }

    private static boolean hostAllowed(String raw) {
        try {
            URL url = new URL(raw);
            return "https".equalsIgnoreCase(url.getProtocol()) && AUDIO_HOST.matcher(url.getHost()).find();
        } catch (Exception error) {
            return false;
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
