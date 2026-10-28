using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;

// GUI subsystem: the detached host never allocates a console of its own.
// Keep the server's hidden console alive after the browser bridge exits.
class RuntimeHost {
    [STAThread] static int Main(string[] args) {
        try {
            if (args.Length != 1 || !Path.IsPathRooted(args[0]) || !File.Exists(args[0])) return 2;
            var info = new ProcessStartInfo(args[0], "serve") {
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = Path.GetDirectoryName(args[0]),
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            info.EnvironmentVariables["OLLAMA_HOST"] = "127.0.0.1:11434";
            using (var server = Process.Start(info)) {
                server.StandardInput.Close();
                var output = server.StandardOutput.BaseStream.CopyToAsync(Stream.Null);
                var errors = server.StandardError.BaseStream.CopyToAsync(Stream.Null);
                Task.Run(() => {
                    // EOF releases ownership to the background host. Only an
                    // explicit cancellation during preparation stops our child.
                    try {
                        using (var reader = new StreamReader(Console.OpenStandardInput())) {
                            string line;
                            while ((line = reader.ReadLine()) != null) {
                                if (line != "cancel") continue;
                                try { if (!server.HasExited) server.Kill(); } catch (InvalidOperationException) {}
                                return;
                            }
                        }
                    } catch (IOException) {}
                });
                server.WaitForExit();
                Task.WaitAll(new[] { output, errors }, 2000);
                return server.ExitCode;
            }
        } catch { return 1; }
    }
}
