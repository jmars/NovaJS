import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;

public class ghidra_ptr extends GhidraScript {
    public void run() throws Exception {
        String[] args = getScriptArgs();
        long v = Long.parseLong(args[0].replaceFirst("^0x", ""), 16);
        Memory mem = currentProgram.getMemory();
        FunctionManager fm = currentProgram.getFunctionManager();
        byte b0 = (byte)(v & 0xff), b1 = (byte)((v>>8)&0xff), b2 = (byte)((v>>16)&0xff), b3 = (byte)((v>>24)&0xff);
        for (MemoryBlock blk : mem.getBlocks()) {
            if (!blk.isInitialized()) continue;
            Address s = blk.getStart();
            byte[] data = new byte[(int) blk.getSize()];
            mem.getBytes(s, data);
            for (int i = 0; i + 4 <= data.length; i++) {
                if (data[i]==b0 && data[i+1]==b1 && data[i+2]==b2 && data[i+3]==b3) {
                    Address at = s.add(i);
                    println("PTR " + at + " in block " + blk.getName());
                    ReferenceIterator rit = currentProgram.getReferenceManager().getReferencesTo(at);
                    while (rit.hasNext()) {
                        Reference r = rit.next();
                        Function f = fm.getFunctionContaining(r.getFromAddress());
                        println("   ref from " + r.getFromAddress() + (f != null ? " FN " + f.getName() + " @ " + f.getEntryPoint() : ""));
                    }
                }
            }
        }
    }
}
