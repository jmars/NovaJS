import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;

public class ghidra_disasm extends GhidraScript {
    public void run() throws Exception {
        String[] args = getScriptArgs();
        Address start = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(args[0]);
        long count = args.length > 1 ? Long.parseLong(args[1]) : 60;
        InstructionIterator it = currentProgram.getListing().getInstructions(start, true);
        long n = 0;
        while (it.hasNext() && n < count) {
            Instruction i = it.next();
            println(i.getAddress() + "  " + i.toString());
            n++;
        }
    }
}
