using System;
using System.IO;
using System.Diagnostics;
using System.Threading.Tasks;
class Launcher {
  static async Task Pump(Stream source,Stream destination) {
    byte[] buffer=new byte[16384];int count;
    while((count=await source.ReadAsync(buffer,0,buffer.Length))>0) {
      await destination.WriteAsync(buffer,0,count);await destination.FlushAsync();
    }
  }
  [STAThread] static int Main(string[] args) {
    try {
      string root=AppDomain.CurrentDomain.BaseDirectory;
      string node=File.ReadAllText(Path.Combine(root,"node-path.txt")).Trim();
      string origin=args.Length>0?args[0]:"";
      if(!System.Text.RegularExpressions.Regex.IsMatch(origin,@"^chrome-extension://[a-p]{32}/?$"))return 2;
      var info=new ProcessStartInfo(node,"\""+Path.Combine(root,"host.cjs")+"\" \""+origin.TrimEnd('/')+"/\"");
      info.UseShellExecute=false;info.CreateNoWindow=true;
      info.RedirectStandardInput=true;info.RedirectStandardOutput=true;info.RedirectStandardError=true;
      using(var child=Process.Start(info)) {
        Task copyIn=Task.Run(async()=>{try{await Pump(Console.OpenStandardInput(),child.StandardInput.BaseStream);child.StandardInput.Close();}catch{}});
        Task copyOut=Pump(child.StandardOutput.BaseStream,Console.OpenStandardOutput());
        Task drain=child.StandardError.BaseStream.CopyToAsync(Stream.Null);
        child.WaitForExit();copyOut.Wait();return child.ExitCode;
      }
    } catch {return 1;}
  }
}
