package me.connorgooch.serverDashboard;

import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.event.Listener;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.entity.Player;
import java.lang.management.ManagementFactory;
import java.net.URI;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public final class ServerDashboard extends JavaPlugin implements Listener {
    private TelemetrySender sender;
    private ScheduledExecutorService clock;
    private ResourceMetrics resources;
    private final AtomicBoolean snapshotPending = new AtomicBoolean();
    private String instanceId;
    private String serverId;
    private long sequence;

    @Override
    public void onEnable() {
        try {
            instanceId = UUID.randomUUID().toString();
            sequence = 0;
            snapshotPending.set(false);
            saveDefaultConfig();
            String secret = getConfig().getString("shared-secret", "");
            if (secret.isBlank()) {
                byte[] random = new byte[32];
                new SecureRandom().nextBytes(random);
                secret = Base64.getUrlEncoder().withoutPadding().encodeToString(random);
                getConfig().set("shared-secret", secret);
                saveConfig();
                getLogger().info("Generated shared-secret in config.yml; configure the ingestion service with the same value.");
            }
            serverId = getConfig().getString("server-id", "minecraft");
            if (serverId.isBlank() || serverId.length() > 128) throw new IllegalArgumentException("server-id must be 1–128 characters");
            resources = new ResourceMetrics(Path.of(getConfig().getString("disk-path", ".")).toAbsolutePath());
            sender = new TelemetrySender(URI.create(getConfig().getString("endpoint", "")), secret, getLogger()::warning);
            getServer().getPluginManager().registerEvents(this, this);
            clock = Executors.newSingleThreadScheduledExecutor(runnable -> {
                var thread = new Thread(runnable, "ServerDashboard-clock");
                thread.setDaemon(true);
                return thread;
            });
            clock.scheduleAtFixedRate(this::requestSnapshot, 0, 10, TimeUnit.SECONDS);
            getLogger().info("Telemetry enabled: snapshots every 10 seconds, immediate player events.");
        } catch (Exception error) {
            // Do not echo config values or secrets into logs.
            getLogger().severe("Cannot enable telemetry (" + error.getClass().getSimpleName() + "); check config.yml and README.");
            getServer().getPluginManager().disablePlugin(this);
        }
    }

    private void requestSnapshot() {
        if (!snapshotPending.compareAndSet(false, true)) return;
        try {
            getServer().getScheduler().runTask(this, () -> {
                try { captureSnapshot(); }
                catch (Exception error) { getLogger().warning("Could not capture telemetry (" + error.getClass().getSimpleName() + ")."); }
                finally { snapshotPending.set(false); }
            });
        } catch (Exception ignored) { snapshotPending.set(false); }
    }

    private Map<String, Object> envelope(String type) {
        var body = new LinkedHashMap<String, Object>();
        body.put("schemaVersion", 1);
        body.put("id", UUID.randomUUID().toString());
        body.put("serverId", serverId);
        body.put("instanceId", instanceId);
        body.put("sequence", ++sequence);
        body.put("type", type);
        body.put("capturedAt", Instant.now().toString());
        return body;
    }

    private static Map<String, Object> player(Player player) {
        return Map.of("name", player.getName(), "uuid", player.getUniqueId().toString());
    }

    private void captureSnapshot() {
        var body = envelope("snapshot");
        body.put("players", getServer().getOnlinePlayers().stream().map(ServerDashboard::player).toList());
        body.put("tps", getServer().getTPS().clone());
        body.put("mspt", getServer().getAverageTickTime());
        body.put("uptimeMillis", ManagementFactory.getRuntimeMXBean().getUptime());
        body.put("minecraftVersion", getServer().getMinecraftVersion());
        sender.offer((String) body.get("id"), () -> {
            body.put("resources", resources.sample());
            return Json.encode(body);
        }, true);
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onJoin(PlayerJoinEvent event) { sendPlayerEvent("player_join", event.getPlayer()); }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onQuit(PlayerQuitEvent event) { sendPlayerEvent("player_leave", event.getPlayer()); }

    private void sendPlayerEvent(String type, Player player) {
        try {
            var body = envelope(type);
            body.put("player", player(player));
            String json = Json.encode(body);
            sender.offer((String) body.get("id"), () -> json, false);
        } catch (Exception error) {
            getLogger().warning("Could not capture player telemetry (" + error.getClass().getSimpleName() + ").");
        }
    }

    @Override
    public void onDisable() {
        if (clock != null) clock.shutdownNow();
        getServer().getScheduler().cancelTasks(this);
        snapshotPending.set(false);
        if (sender != null) sender.close();
    }
}
