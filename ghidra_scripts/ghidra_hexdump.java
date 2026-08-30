import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;

public class ghidra_hexdump extends GhidraScript {
    public void run() throws Exception {
        String[] args = getScriptArgs();
        for (int k = 0; k + 1 < args.length; k += 2) {
            Address a = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(args[k]);
            int n = Integer.parseInt(args[k + 1]);
            byte[] buf = new byte[n];
            currentProgram.getMemory().getBytes(a, buf);
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < n; i++) {
                if (i % 16 == 0) sb.append(String.format("\n  %s: ", a.add(i)));
                sb.append(String.format("%02x ", buf[i]));
                char c = (char)(buf[i] & 0xff);
                sb.append(c >= 0x20 && c < 0x7f ? Character.toString(c) : '.').append(' ');
            }
            println("=== " + args[k] + " ===" + sb);
        }
    }
}
