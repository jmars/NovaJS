import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.listing.Listing;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;

public class ghidra_scan526 extends GhidraScript {
    public void run() throws Exception {
        Address start = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress("0x00401000");
        Address end = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress("0x0056a000");
        Listing l = currentProgram.getListing();
        InstructionIterator it = l.getInstructions(new AddressSet(start, end), true);
        long hits = 0;
        while (it.hasNext()) {
            Instruction ins = it.next();
            String s = ins.toString();
            if (s.contains("0x526")) {
                Function f = getFunctionContaining(ins.getAddress());
                println((f == null ? "?" : f.getName() + "@" + f.getEntryPoint()) + " " + ins.getAddress() + "  " + s);
                hits++;
            }
        }
        println("total " + hits);
    }
}
