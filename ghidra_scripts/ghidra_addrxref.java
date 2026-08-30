import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.Listing;

public class ghidra_addrxref extends GhidraScript {
    public void run() throws Exception {
        String[] args = getScriptArgs();
        Listing l = currentProgram.getListing();
        for (String a : args) {
            String pat = a.substring(6, 8) + " " + a.substring(4, 6) + " " + a.substring(2, 4) + " 00";
            println("=== " + a + " (" + pat + ") ===");
            Address p = currentProgram.getMinAddress();
            while (p != null) {
                p = findBytes(p, pat);
                if (p == null) break;
                Instruction i = l.getInstructionContaining(p);
                if (i != null) println("  " + i.getAddress() + " " + i);
                p = p.add(1);
            }
        }
    }
}
