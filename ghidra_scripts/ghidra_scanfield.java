import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.listing.Listing;
import ghidra.program.model.listing.Function;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.address.Address;

public class ghidra_scanfield extends GhidraScript {
    public void run() throws Exception {
        Address start = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress("0x00401000");
        Address end = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress("0x0056a000");
        long[] targets = new long[getScriptArgs().length];
        for (int i = 0; i < getScriptArgs().length; i++) {
            targets[i] = Long.decode(getScriptArgs()[i]);
        }
        Listing l = currentProgram.getListing();
        InstructionIterator it = l.getInstructions(new AddressSet(start, end), true);
        while (it.hasNext()) {
            Instruction ins = it.next();
            String s = ins.toString();
            for (long t : targets) {
                String hex = "0x" + Long.toHexString(t);
                if (s.contains(hex)) {
                    Function f = getFunctionContaining(ins.getAddress());
                    println((f == null ? "?" : f.getName() + "@" + f.getEntryPoint()) + " " + ins.getAddress() + "  " + s);
                    break;
                }
            }
        }
    }
}
