import ghidra.app.script.GhidraScript;

public class ghidra_blocks extends GhidraScript {
    public void run() throws Exception {
        for (var b : currentProgram.getMemory().getBlocks()) {
            println("  " + b.getName() + " " + b.getStart() + "-" + b.getEnd() + " " + (b.isInitialized() ? "init" : "uninit"));
        }
    }
}
