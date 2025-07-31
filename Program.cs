using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Collections.Concurrent;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.UseWebSockets();

var clients = new ConcurrentDictionary<string, WebSocket>();

app.Use(async (context, next) =>
{
    if (context.Request.Path == "/ws" && context.WebSockets.IsWebSocketRequest)
    {
        var socket = await context.WebSockets.AcceptWebSocketAsync();
        string? userId = null;

        Console.WriteLine("🌐 New WebSocket connection established.");

        var buffer = new byte[4096];

        try
        {
            while (socket.State == WebSocketState.Open)
            {
                using var ms = new MemoryStream();
                WebSocketReceiveResult result;

                do
                {
                    result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
                    ms.Write(buffer, 0, result.Count);
                } while (!result.EndOfMessage);

                var rawMessage = Encoding.UTF8.GetString(ms.ToArray());
                Console.WriteLine($"📩 Received: {rawMessage}");

                if (string.IsNullOrWhiteSpace(rawMessage)) continue;

                SignalMessage? message = null;
                try
                {
                    message = JsonSerializer.Deserialize<SignalMessage>(rawMessage);
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"❌ Failed to parse message: {ex.Message}");
                    continue;
                }

                if (message is null || string.IsNullOrEmpty(message.SenderId))
                    continue;

                // Register userId only once
                if (userId == null)
                {
                    userId = message.SenderId;
                    if (!clients.TryAdd(userId, socket))
                    {
                        Console.WriteLine($"⚠️ Could not register userId {userId} (already exists)");
                    }
                    else
                    {
                        Console.WriteLine($"✅ Registered senderId: {userId}, total clients: {clients.Count}");
                    }
                }

                // Handle ping (for testing)
                if (message.Type == "ping")
                {
                    Console.WriteLine($"🔁 Ping from {message.SenderId}");
                    continue;
                }

                // Forward to target
                if (!string.IsNullOrEmpty(message.TargetUserId))
                {
                    if (clients.TryGetValue(message.TargetUserId, out var targetSocket))
                    {
                        if (targetSocket.State == WebSocketState.Open)
                        {
                            try
                            {
                                var forwardJson = JsonSerializer.Serialize(message);
                                await targetSocket.SendAsync(
                                    new ArraySegment<byte>(Encoding.UTF8.GetBytes(forwardJson)),
                                    WebSocketMessageType.Text,
                                    true,
                                    CancellationToken.None
                                );
                                Console.WriteLine($"➡️ Forwarded '{message.Type}' from {message.SenderId} to {message.TargetUserId}");
                            }
                            catch (Exception ex)
                            {
                                Console.WriteLine($"❌ Failed to send to {message.TargetUserId}: {ex.Message}");
                            }
                        }
                        else
                        {
                            Console.WriteLine($"⚠️ Target socket for {message.TargetUserId} is not open. State: {targetSocket.State}");
                            clients.TryRemove(message.TargetUserId, out _);
                        }
                    }
                    else
                    {
                        Console.WriteLine($"❌ Could not forward '{message.Type}' — target {message.TargetUserId} not found");
                    }
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"❌ Error: {ex.Message}");
        }

        if (userId != null)
        {
            clients.TryRemove(userId, out _);
            Console.WriteLine($"👋 Client disconnected: {userId}");
        }

        if (socket.State == WebSocketState.Open)
        {
            await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closing", CancellationToken.None);
        }
    }
    else
    {
        await next();
    }
});

app.Run();

record SignalMessage(string Type, string? TargetUserId, string SenderId, JsonElement Data);
