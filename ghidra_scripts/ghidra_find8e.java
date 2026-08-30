import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.scalar.Scalar;

public class ghidra_find8e extends GhidraScript {
    public void run() throws Exception {
        long[] targets = {0x8e, 0x8c, 0x90, 0x92, 0x94, 0x96, 0x98, 0x9a, 0x88, 0x86, 0x84};
        InstructionIterator ii = currentProgram.getListing().getInstructions(true);
        while (ii.hasNext()) {
            Instruction i = ii.next();
            for (int op = 0; op < i.getNumOperands(); op++) {
                for (Object o : i.getOpObjects(op)) {
                    if (o instanceof Scalar) {
                        long v = ((Scalar) o).getValue();
                        for (long t : targets) {
                            if (v == t) {
                                println("@" + i.getAddress() + " disp " + t + " : " + i);
                            }
                        }
                    }
                }
            }
        }
    }
}
