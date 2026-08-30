import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.listing.*;
import ghidra.program.model.mem.MemoryBlock;

public class ghidra_prices extends GhidraScript {
    public void run() throws Exception {
        // 1) References to the 6-commodity price arrays
        String[] addrs = {"005997cc", "005999cc", "00599acc"};
        for (String a : addrs) {
            Address addr = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(a);
            Reference[] refs = getReferencesTo(addr);
            println("=== refs to " + a + " ===");
            for (Reference r : refs) println("   from " + r.getFromAddress());
        }
        // 2) Search .rdata for the float constants 0.75 (3f400000), 1.25 (3fa00000), 0.25 (3e800000), 0.10 (3dcccccd)
        println("=== float constant locations ===");
        MemoryBlock[] blocks = currentProgram.getMemory().getBlocks();
        for (MemoryBlock b : blocks) {
            if (!b.getName().contains("rdata") && !b.getName().toLowerCase().contains("data")) continue;
            byte[] bytes = new byte[(int)b.getSize()];
            currentProgram.getMemory().getBytes(b.getStart(), bytes);
            int[][] pats = {{0x00,0x00,0x40,0x3f}, {0x00,0x00,0xa0,0x3f}, {0x00,0x00,0x80,0x3e}, {0xcd,0xcc,0xcc,0x3d}};
            String[] names = {"0.75","1.25","0.25","0.10"};
            for (int pi=0;pi<pats.length;pi++){
                int[] p=pats[pi];
                for (int i=0;i<bytes.length-3;i++){
                    if (bytes[i]==(byte)p[0]&&bytes[i+1]==(byte)p[1]&&bytes[i+2]==(byte)p[2]&&bytes[i+3]==(byte)p[3]){
                        println(names[pi]+" @"+b.getStart().add(i));
                    }
                }
            }
        }
    }
}
