package app.kinetix.player;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** MediaSession + MediaStyle notification so the lock screen shows the track and its controls. */
public final class PlaybackService extends Service {
    private static final String TAG = "KinetixPlayback";
    private static final String CHANNEL_ID = "kinetix-playback";
    private static final String EXTRA_PAYLOAD = "payload";
    private static final int NOTIFICATION_ID = 4102;

    static final String ACTION_UPDATE = "app.kinetix.player.PLAYBACK_UPDATE";
    static final String ACTION_PREVIOUS = "app.kinetix.player.PREVIOUS";
    static final String ACTION_TOGGLE = "app.kinetix.player.TOGGLE";
    static final String ACTION_NEXT = "app.kinetix.player.NEXT";

    interface RemoteListener {
        void onRemote(String action, Double value);
    }

    private static volatile PlaybackService instance;
    private static volatile String pendingPayload;
    private static volatile RemoteListener remoteListener;

    private final Handler main = new Handler(Looper.getMainLooper());
    private ExecutorService artworkPool;
    private MediaSession session;
    private Bitmap artwork;
    private String artworkUrl = "";
    private int artworkGeneration;

    private String title = "Kinetix";
    private String artist = "";
    private double durationSeconds;
    private double elapsedSeconds;
    private boolean playing;

    static void setRemoteListener(RemoteListener listener) {
        remoteListener = listener;
    }

    /** Called from the WebView bridge. Starts the service only when there is something to show. */
    static void publish(Context context, String payload) {
        if (payload == null || payload.isEmpty()) return;
        try {
            if ("clear".equals(new JSONObject(payload).optString("action"))) {
                PlaybackService running = instance;
                if (running != null) running.apply(payload);
                return;
            }
        } catch (Exception error) {
            return;
        }
        PlaybackService running = instance;
        if (running != null) {
            running.apply(payload);
            return;
        }
        pendingPayload = payload;
        Intent intent = new Intent(context, PlaybackService.class).setAction(ACTION_UPDATE).putExtra(EXTRA_PAYLOAD, payload);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent);
            else context.startService(intent);
        } catch (Exception error) {
            pendingPayload = null;
            Log.w(TAG, "Не удалось запустить воспроизведение в фоне", error);
        }
    }

    static void stop(Context context) {
        instance = null;
        try {
            context.stopService(new Intent(context, PlaybackService.class));
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        artworkPool = Executors.newSingleThreadExecutor();

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Воспроизведение", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Плеер на экране блокировки");
            channel.setShowBadge(false);
            channel.setSound(null, null);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            manager.createNotificationChannel(channel);
        }

        session = new MediaSession(this, "Kinetix");
        session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        session.setSessionActivity(openIntent());
        session.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() {
                forward("play", null);
            }

            @Override
            public void onPause() {
                forward("pause", null);
            }

            @Override
            public void onStop() {
                forward("pause", null);
            }

            @Override
            public void onSkipToNext() {
                forward("next", null);
            }

            @Override
            public void onSkipToPrevious() {
                forward("previous", null);
            }

            @Override
            public void onSeekTo(long position) {
                forward("seek", position / 1000.0);
            }
        });
        session.setActive(true);

        String payload = pendingPayload;
        pendingPayload = null;
        if (payload != null) parse(payload);

        Notification notification = build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        push();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && intent.hasExtra(EXTRA_PAYLOAD)) apply(intent.getStringExtra(EXTRA_PAYLOAD));
        String action = intent == null ? null : intent.getAction();
        if (ACTION_PREVIOUS.equals(action)) forward("previous", null);
        else if (ACTION_NEXT.equals(action)) forward("next", null);
        else if (ACTION_TOGGLE.equals(action)) forward("toggle", null);
        return START_NOT_STICKY;
    }

    private void apply(String payload) {
        if (payload == null || payload.isEmpty()) return;
        main.post(() -> {
            JSONObject object;
            try {
                object = new JSONObject(payload);
            } catch (Exception error) {
                return;
            }
            if ("clear".equals(object.optString("action"))) {
                clear();
                return;
            }
            title = object.optString("title", "Kinetix").trim();
            artist = object.optString("artist", "").trim();
            playing = object.optDouble("rate", 0) > 0;
            durationSeconds = Math.max(0, object.optDouble("duration", 0));
            elapsedSeconds = Math.max(0, object.optDouble("elapsed", 0));
            if (durationSeconds > 0) elapsedSeconds = Math.min(elapsedSeconds, durationSeconds);
            String url = object.optString("artwork", "");
            if (!url.equals(artworkUrl)) {
                artworkUrl = url;
                artwork = null;
                artworkGeneration++;
                loadArtwork(url, artworkGeneration);
            }
            push();
        });
    }

    private void parse(String payload) {
        try {
            JSONObject object = new JSONObject(payload);
            title = object.optString("title", "Kinetix").trim();
            artist = object.optString("artist", "").trim();
            playing = object.optDouble("rate", 0) > 0;
            durationSeconds = Math.max(0, object.optDouble("duration", 0));
            elapsedSeconds = Math.max(0, object.optDouble("elapsed", 0));
            artworkGeneration++;
        } catch (Exception ignored) {
        }
    }

    private void push() {
        if (session == null) return;
        long durationMs = Math.round(durationSeconds * 1000);
        long elapsedMs = Math.round(elapsedSeconds * 1000);

        MediaMetadata.Builder metadata = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title.isEmpty() ? "Kinetix" : title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, artist.isEmpty() ? "Kinetix" : artist)
                .putString(MediaMetadata.METADATA_KEY_ALBUM, "Kinetix");
        if (durationMs > 0) metadata.putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs);
        if (artwork != null) {
            metadata.putBitmap(MediaMetadata.METADATA_KEY_ART, artwork);
            metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork);
        }
        session.setMetadata(metadata.build());

        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS;
        if (durationMs > 0) actions |= PlaybackState.ACTION_SEEK_TO;
        int state = playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED;
        PlaybackState playback = new PlaybackState.Builder()
                .setActions(actions)
                .setState(state, elapsedMs, playing ? 1f : 0f, SystemClock.elapsedRealtime())
                .build();
        session.setPlaybackState(playback);
        session.setActive(true);

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(NOTIFICATION_ID, build());
    }

    private void clear() {
        if (session != null) {
            session.setPlaybackState(new PlaybackState.Builder().setState(PlaybackState.STATE_STOPPED, 0, 0f).build());
            session.setMetadata(null);
            session.setActive(false);
        }
        artwork = null;
        artworkUrl = "";
        artworkGeneration++;
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.cancel(NOTIFICATION_ID);
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private Notification build() {
        Notification.Builder builder = new Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title.isEmpty() ? "Kinetix" : title)
                .setContentText(artist.isEmpty() ? "Kinetix" : artist)
                .setContentIntent(openIntent())
                .setOngoing(playing)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setCategory(Notification.CATEGORY_TRANSPORT)
                .setStyle(new Notification.MediaStyle()
                        .setMediaSession(session.getSessionToken())
                        .setShowActionsInCompactView(0, 1, 2))
                .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous, "Предыдущий", command(ACTION_PREVIOUS, 1)).build())
                .addAction(new Notification.Action.Builder(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, playing ? "Пауза" : "Играть", command(ACTION_TOGGLE, 2)).build())
                .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_next, "Следующий", command(ACTION_NEXT, 3)).build());
        if (artwork != null) builder.setLargeIcon(artwork);
        return builder.build();
    }

    private PendingIntent openIntent() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private PendingIntent command(String action, int requestCode) {
        Intent intent = new Intent(this, PlaybackService.class).setAction(action);
        return PendingIntent.getService(this, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void forward(String action, Double value) {
        RemoteListener listener = remoteListener;
        if (listener == null) return;
        try {
            listener.onRemote(action, value);
        } catch (Exception ignored) {
        }
    }

    private void loadArtwork(String raw, int generation) {
        if (raw == null || raw.isEmpty() || raw.length() > 2048) return;
        if (!raw.startsWith("https://") && !raw.startsWith("http://")) return;
        artPool().execute(() -> {
            Bitmap bitmap = fetch(raw);
            if (bitmap == null) return;
            main.post(() -> {
                if (generation == artworkGeneration && raw.equals(artworkUrl)) {
                    artwork = bitmap;
                    push();
                }
            });
        });
    }

    private ExecutorService artPool() {
        ExecutorService pool = artworkPool;
        if (pool == null || pool.isShutdown()) {
            pool = Executors.newSingleThreadExecutor();
            artworkPool = pool;
        }
        return pool;
    }

    private Bitmap fetch(String address) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(address).openConnection();
            connection.setConnectTimeout(6000);
            connection.setReadTimeout(8000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("User-Agent", "Kinetix/1.0 (Android)");
            connection.setRequestProperty("Accept", "image/*");
            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) return null;
            try (InputStream input = new BufferedInputStream(connection.getInputStream())) {
                ByteArrayOutputStream buffer = new ByteArrayOutputStream(64 * 1024);
                byte[] chunk = new byte[16 * 1024];
                int read;
                int total = 0;
                while ((read = input.read(chunk)) > 0) {
                    total += read;
                    if (total > 8 * 1024 * 1024) return null;
                    buffer.write(chunk, 0, read);
                }
                byte[] bytes = buffer.toByteArray();
                if (bytes.length == 0) return null;
                BitmapFactory.Options bounds = new BitmapFactory.Options();
                bounds.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
                int longest = Math.max(bounds.outWidth, bounds.outHeight);
                int sample = 1;
                while (longest / sample > 512) sample *= 2;
                BitmapFactory.Options options = new BitmapFactory.Options();
                options.inSampleSize = sample;
                return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
            }
        } catch (Exception error) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        clear();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        instance = null;
        pendingPayload = null;
        if (session != null) {
            session.setActive(false);
            session.release();
            session = null;
        }
        if (artworkPool != null) artworkPool.shutdownNow();
        artworkPool = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
