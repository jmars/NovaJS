import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;

public class ghidra_str2 extends GhidraScript {
    public void run() throws Exception {
        String[] pats = { "dude", "fleet", "pers", "Dude", "Fleet", "Pers" };
        for (String p : pats) {
            println("=== " + p + " ===");
            Address a = currentProgram.getMinAddress();
            int n = 0;
            while (a != null && n < 40) {
                a = findBytes(a, p);
                if (a == null) break;
                // print surrounding ascii
                byte[] buf = new byte[80];
                currentProgram.getMemory().getBytes(a, buf);
                StringBuilder sb = new StringBuilder();
                for (byte b : buf) {
                    char c = (char)(b & 0xff);
                    if (c >= 0x20 && c < 0x7f) sb.append(c); else break;
                }
                println("  " + a + " \"" + sb + "\"");
                n++;
                a = a.add(1);
            }
        }
    }
}
