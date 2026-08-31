import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;

public class ghidra_decbig extends GhidraScript {
    @Override
    public void run() throws Exception {
        DecompInterface di = new DecompInterface();
        DecompileOptions opts = new DecompileOptions();
        opts.setMaxInstructions(200000);
        di.setOptions(opts);
        di.openProgram(currentProgram);
        for (String arg : getScriptArgs()) {
            Address a = currentProgram.getAddressFactory().getAddress(arg);
            Function f = getFunctionContaining(a);
            if (f == null) { println("no function at " + arg); continue; }
            DecompileResults r = di.decompileFunction(f, 600, monitor);
            if (r.getDecompiledFunction() == null) { println("FAILED " + f.getName()); continue; }
            println("=== " + f.getName() + " @ " + f.getEntryPoint());
            println(r.getDecompiledFunction().getC());
        }
    }
}
