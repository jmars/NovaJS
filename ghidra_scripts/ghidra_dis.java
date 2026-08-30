import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
public class ghidra_dis extends GhidraScript {
    public void run() throws Exception {
        String[] a = getScriptArgs();
        Address start = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(a[0].replaceFirst("^0x",""));
        long n = a.length > 1 ? Long.parseLong(a[1]) : 40;
        InstructionIterator ii = currentProgram.getListing().getInstructions(start, true);
        while (ii.hasNext() && n-- > 0) {
            Instruction i = ii.next();
            println(i.getAddress() + "  " + i.toString());
        }
    }
}
