import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.RefType;

public class ghidra_anchors extends GhidraScript {
    public void run() throws Exception {
        String[] targets = getScriptArgs();
        for (String t : targets) {
            Address a = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(t);
            println("=== refs TO " + t + " ===");
            Reference[] refs = getReferencesTo(a);
            for (Reference r : refs) {
                println("  from " + r.getFromAddress() + " " + r.getReferenceType());
            }
        }
    }
}
