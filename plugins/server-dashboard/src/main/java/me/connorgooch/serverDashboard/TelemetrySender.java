package me.connorgooch.serverDashboard;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.function.Consumer;
import java.util.function.Supplier;

/** One in-flight request, at most 256 queued events and one coalesced snapshot. */
final class TelemetrySender implements AutoCloseable {
    static final int EVENT_CAPACITY = 256;
    private final URI endpoint;
    private final String secret;
    private final Consumer<String> warning;
    private final ArrayDeque<Message> events = new ArrayDeque<>();
    private Message snapshot;
    private final Thread worker;
    private volatile boolean closed;
    private long lastWarningNanos;

    private record Message(String id, Supplier<String> body, long createdNanos, boolean snapshot) {}

    TelemetrySender(URI endpoint, String secret, Consumer<String> warning) {
        this.endpoint = validateEndpoint(endpoint);
        if (secret == null || secret.length() < 32 || !secret.matches("[A-Za-z0-9_\\-]+")) {
            throw new IllegalArgumentException("shared-secret must contain at least 32 URL-safe characters");
        }
        this.secret = secret;
        this.warning = warning;
        worker = new Thread(this::run, "ServerDashboard-delivery");
        worker.setDaemon(true);
        worker.start();
    }

    static URI validateEndpoint(URI uri) {
        String host = uri.getHost();
        if (!"http".equals(uri.getScheme()) || !("127.0.0.1".equals(host) || "[::1]".equals(host))
            || uri.getUserInfo() != null || uri.getFragment() != null || uri.getQuery() != null
            || uri.getPort() < 1 || uri.getPort() > 65535) {
            throw new IllegalArgumentException("endpoint must be an HTTP URL at 127.0.0.1 or [::1] with an explicit port");
        }
        return uri;
    }

    synchronized void offer(String id, Supplier<String> body, boolean isSnapshot) {
        if (closed) return;
        var message = new Message(id, body, System.nanoTime(), isSnapshot);
        if (isSnapshot) snapshot = message;
        else {
            if (events.size() == EVENT_CAPACITY) {
                events.removeFirst();
                warn("Telemetry event queue full; oldest event dropped. Snapshots reconcile player state.");
            }
            events.addLast(message);
        }
        notifyAll();
    }

    synchronized int queuedMessages() { return events.size() + (snapshot == null ? 0 : 1); }

    private synchronized Message take() throws InterruptedException {
        while (!closed && events.isEmpty() && snapshot == null) wait();
        if (closed) return null;
        // A recovery snapshot must not sit behind an outage's event backlog.
        if (snapshot != null) {
            var next = snapshot;
            snapshot = null;
            return next;
        }
        return events.removeFirst();
    }

    private void run() {
        // A discarding body handler prevents a broken listener from filling memory with response bodies.
        try (var client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2))
            .followRedirects(HttpClient.Redirect.NEVER).proxy(new java.net.ProxySelector() {
                @Override public java.util.List<java.net.Proxy> select(URI uri) { return java.util.List.of(java.net.Proxy.NO_PROXY); }
                @Override public void connectFailed(URI uri, java.net.SocketAddress address, java.io.IOException error) {}
            }).build()) {
            while (!closed) {
                Message message = take();
                if (message == null) break;
                try { deliver(client, message); }
                catch (InterruptedException interrupted) { throw interrupted; }
                catch (Exception error) { warn("Telemetry preparation failed (" + error.getClass().getSimpleName() + ")."); }
            }
        } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
        catch (Exception error) { warn("Telemetry worker stopped (" + error.getClass().getSimpleName() + ")."); }
    }

    private void deliver(HttpClient client, Message message) throws InterruptedException {
        if (expired(message)) return;
        String body = message.body().get(); // Freeze payload and ID across retries.
        for (int attempt = 0; attempt < 3 && !closed && !expired(message); attempt++) {
            try {
                var request = HttpRequest.newBuilder(endpoint).timeout(Duration.ofSeconds(3))
                    .header("Authorization", "Bearer " + secret)
                    .header("Content-Type", "application/json")
                    .header("Idempotency-Key", message.id())
                    .POST(HttpRequest.BodyPublishers.ofString(body)).build();
                int status = client.send(request, HttpResponse.BodyHandlers.discarding()).statusCode();
                if (status >= 200 && status < 300) return;
                if (status != 408 && status != 429 && status < 500) {
                    warn("Telemetry rejected (HTTP " + status + "); check ingestion configuration.");
                    return;
                }
            } catch (java.io.IOException ignored) { /* bounded retry */ }
            if (attempt < 2) Thread.sleep(1000L << attempt);
        }
        if (!closed) warn("Telemetry delivery failed after bounded retries; later snapshots will reconcile state.");
    }

    private boolean expired(Message message) {
        return System.nanoTime() - message.createdNanos() > Duration.ofSeconds(message.snapshot() ? 30 : 120).toNanos();
    }

    private synchronized void warn(String message) {
        long now = System.nanoTime();
        if (lastWarningNanos == 0 || now - lastWarningNanos >= Duration.ofSeconds(60).toNanos()) {
            lastWarningNanos = now;
            warning.accept(message);
        }
    }

    @Override public synchronized void close() {
        closed = true;
        events.clear();
        snapshot = null;
        worker.interrupt();
        notifyAll(); // Shutdown never waits for HTTP on the game thread.
    }
}
