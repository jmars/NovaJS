import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.symbol.RefType;
import ghidra.program.model.symbol.Reference;

public class ghidra_calls extends GhidraScript {
    public void run() throws Exception {
        String[] args = getScriptArgs();
        Address start = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(args[0]);
        Address end = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(args[1]);
        InstructionIterator ii = currentProgram.getListing().getInstructions(true);
        while (ii.hasNext()) {
            Instruction i = ii.next();
            Address a = i.getAddress();
            if (a.compareTo(start) < 0 || a.compareTo(end) > 0) continue;
            Reference[] refs = i.getReferencesFrom();
            for (Reference r : refs) {
                RefType t = r.getReferenceType();
                if (t.isCall()) {
                    println("CALL " + a + " -> " + r.getToAddress());
                }
            }
        }
    }
}
