import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;

public class ghidra_pool extends GhidraScript {
    public void run() throws Exception {
        String[] args = getScriptArgs();
        Address start = currentProgram.getAddressFactory().getDefaultAddressSpace()
            .getAddress(args[0].replaceFirst("^0x", ""));
        int len = Integer.decode(args[1]);
        Memory mem = currentProgram.getMemory();
        FunctionManager fm = currentProgram.getFunctionManager();
        byte[] buf = new byte[len];
        mem.getBytes(start, buf);
        for (int i = 0; i + 8 <= len; i += 8) {
            long v = 0;
            for (int j = 7; j >= 0; j--) v = (v << 8) | (buf[i + j] & 0xff);
            double d = Double.longBitsToDouble(v);
            if (!Double.isFinite(d)) continue;
            if (d == 0.0) continue;
            if (Math.abs(d) > 1e9 || Math.abs(d) < 1e-6) continue;
            Address at = start.add(i);
            StringBuilder refs = new StringBuilder();
            ReferenceIterator rit = currentProgram.getReferenceManager().getReferencesTo(at);
            boolean first = true;
            while (rit.hasNext()) {
                Reference r = rit.next();
                Function f = fm.getFunctionContaining(r.getFromAddress());
                if (first) { refs.append("  <- "); first = false; }
                else refs.append(", ");
                refs.append(r.getFromAddress()).append(f != null ? "@" + f.getName() : "");
            }
            println(String.format("%s = %g%s", at, d, refs.toString()));
        }
    }
}
