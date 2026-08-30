import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.Reference;
import java.util.TreeSet;

public class ghidra_gxref extends GhidraScript {
    @Override
    public void run() throws Exception {
        for (String arg : getScriptArgs()) {
            Address a = currentProgram.getAddressFactory().getDefaultAddressSpace()
                .getAddress(arg.replaceFirst("^0x", ""));
            Reference[] refs = getReferencesTo(a);
            TreeSet<String> fns = new TreeSet<>();
            for (Reference r : refs) {
                Function f = getFunctionContaining(r.getFromAddress());
                fns.add((f != null ? f.getName() : "?") + "@" + r.getFromAddress());
            }
            println("### XREFS to " + arg + " (" + refs.length + "):");
            for (String s : fns) println("   " + s);
        }
    }
}
