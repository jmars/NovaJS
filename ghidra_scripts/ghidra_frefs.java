import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;

public class ghidra_frefs extends GhidraScript {
    public void run() throws Exception {
        String[] args = getScriptArgs();
        Address target = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(args[0]);
        ReferenceIterator it = currentProgram.getReferenceManager().getReferencesTo(target);
        FunctionManager fm = currentProgram.getFunctionManager();
        AddressSet fns = new AddressSet();
        while (it.hasNext()) {
            Reference r = it.next();
            Address from = r.getFromAddress();
            Function f = fm.getFunctionContaining(from);
            if (f != null) {
                if (!fns.contains(f.getEntryPoint())) {
                    fns.add(f.getEntryPoint());
                    println("FN " + f.getName() + " @ " + f.getEntryPoint() + " (ref at " + from + ")");
                }
            } else {
                println("ref from " + from + " (no function)");
            }
        }
    }
}
