import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.Listing;

public class ghidra_dref extends GhidraScript {
    public void run() throws Exception {
        Listing l = currentProgram.getListing();
        for (String a : getScriptArgs()) {
            Address at = currentProgram.getAddressFactory().getAddress(a);
            println("=== refs to " + a + " ===");
            Reference[] rs = getReferencesTo(at);
            for (Reference r : rs) {
                Address from = r.getFromAddress();
                Instruction i = l.getInstructionContaining(from);
                println("  " + from + " " + (i == null ? "(data)" : i.toString()));
            }
            if (rs.length == 0) println("  (none)");
        }
    }
}
