package mineness;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

public final class ModelCommand extends JavaPlugin {
    private static final List<String> BOTS = List.of("claude", "codex", "grok", "cursor");
    private static final List<String> EFFORTS = List.of("none", "minimal", "low", "medium", "high", "xhigh", "max");
    private final Gson gson = new Gson();
    private final Path runtime = Path.of("..", ".runtime").toAbsolutePath().normalize();
    private final Map<String, Pending> pending = new HashMap<>();
    private record Pending(CommandSender sender, String id, long started) {}

    @Override public void onEnable() {
        getCommand("model").setExecutor(this);
        getCommand("model").setTabCompleter(this);
        getServer().getScheduler().runTaskTimer(this, this::deliverResults, 20L, 20L);
    }

    private String botName(String value) {
        return value.toLowerCase(Locale.ROOT).replaceFirst("^@", "").replaceFirst("_bot$", "");
    }

    private JsonObject read(Path file) throws Exception {
        if (!Files.exists(file)) return new JsonObject();
        if (Files.size(file) > 16384) throw new IllegalStateException("Oversized model status file");
        return gson.fromJson(Files.readString(file), JsonObject.class);
    }

    private String text(JsonObject object, String key, String fallback) {
        return object.has(key) && !object.get(key).isJsonNull() ? object.get(key).getAsString() : fallback;
    }

    private void tell(CommandSender sender, String message) {
        if (!(sender instanceof Player player) || player.isOnline()) sender.sendMessage(Component.text("[Mineness] " + message));
    }

    @Override public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (sender instanceof Player && sender.getName().toLowerCase(Locale.ROOT).endsWith("_bot") && BOTS.contains(botName(sender.getName()))) {
            tell(sender, "Only human players can change teammate models.");
            return true;
        }
        if (args.length < 1 || args.length > 3) {
            tell(sender, "Usage: /model @bot [model-id] [effort]. Example: /model @cursor grok-4.6 high");
            return true;
        }
        String bot = botName(args[0]);
        if (!BOTS.contains(bot)) {
            tell(sender, "Unknown teammate. Use @claude, @codex, @grok, or @cursor.");
            return true;
        }
        Path directory = runtime.resolve(bot);
        try {
            JsonObject state = read(directory.resolve("model-state.json"));
            long heartbeat = state.has("heartbeatAt") ? state.get("heartbeatAt").getAsLong() : 0;
            boolean connected = System.currentTimeMillis() - heartbeat < 15000;
            if (args.length == 1) {
                String effort = text(state, "effort", "");
                tell(sender, "@" + bot + ": " + text(state, "model", "CLI default") + (effort.isEmpty() ? "" : ", effort " + effort)
                    + ". " + (connected ? text(state, "status", "offline") + ". " + text(state, "message", "") : "Launcher offline. Start npm run play -- " + bot));
                return true;
            }
            if (!args[1].matches("[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}")) {
                tell(sender, "Use a CLI model ID, without spaces or shell syntax.");
                return true;
            }
            if (args.length == 3 && !EFFORTS.contains(args[2])) {
                tell(sender, "Effort must be none, minimal, low, medium, high, xhigh, or max.");
                return true;
            }
            if (!connected) {
                tell(sender, "The @" + bot + " launcher is offline. Start npm run play -- " + bot + " first.");
                return true;
            }
            Path requestFile = directory.resolve("model-request.json");
            if (pending.containsKey(bot) || Files.exists(requestFile) || List.of("starting", "switching").contains(text(state, "status", ""))) {
                tell(sender, "@" + bot + " is already connecting. Wait for its result.");
                return true;
            }
            String id = UUID.randomUUID().toString();
            JsonObject request = new JsonObject();
            request.addProperty("id", id);
            request.addProperty("model", args[1]);
            if (args.length == 3) request.addProperty("effort", args[2]);
            Path temporary = directory.resolve("model-request." + id + ".tmp");
            Files.writeString(temporary, gson.toJson(request), StandardCharsets.UTF_8);
            Files.move(temporary, requestFile, StandardCopyOption.ATOMIC_MOVE);
            pending.put(bot, new Pending(sender, id, System.currentTimeMillis()));
            tell(sender, "Switching @" + bot + " to " + args[1] + (args.length == 3 ? ", effort " + args[2] : "") + ". Its current action will stop.");
        } catch (Exception error) {
            getLogger().warning("Model command failed: " + error.getMessage());
            tell(sender, "Could not contact the teammate launcher. Check the server log.");
        }
        return true;
    }

    private void deliverResults() {
        var iterator = pending.entrySet().iterator();
        while (iterator.hasNext()) {
            var entry = iterator.next();
            Pending request = entry.getValue();
            try {
                JsonObject state = read(runtime.resolve(entry.getKey()).resolve("model-state.json"));
                if (request.id().equals(text(state, "requestId", "")) && !text(state, "result", "").isEmpty()) {
                    tell(request.sender(), "@" + entry.getKey() + ": " + text(state, "message", "Model change finished."));
                    iterator.remove();
                } else if (System.currentTimeMillis() - request.started() > 210000) {
                    tell(request.sender(), "@" + entry.getKey() + " has not confirmed the change. Use /model @" + entry.getKey() + " to check its state.");
                    iterator.remove();
                }
            } catch (Exception error) {
                getLogger().warning("Cannot read model change result: " + error.getMessage());
            }
        }
    }

    @Override public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        List<String> choices = args.length == 1 ? BOTS.stream().map(name -> "@" + name).toList()
            : args.length == 2 ? List.of("default") : args.length == 3 ? EFFORTS : List.of();
        String prefix = args.length == 0 ? "" : args[args.length - 1].toLowerCase(Locale.ROOT);
        return choices.stream().filter(value -> value.startsWith(prefix)).toList();
    }
}
