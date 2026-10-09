import java.lang.classfile.ClassFile;
import java.lang.classfile.ClassTransform;
import java.lang.classfile.CodeBuilder;
import java.lang.classfile.CodeElement;
import java.lang.classfile.CodeTransform;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.jar.JarFile;

/** Render every saved chunk, including legacy terrain with incomplete generation metadata. */
public final class PatchRenderer {
    public static void main(String[] args) throws Exception {
        if (args.length != 2) {
            throw new IllegalArgumentException("Expected verified BlueMap JAR and output directory");
        }
        var classFile = ClassFile.of();
        try (var jar = new JarFile(args[0])) {
            for (var version : new String[] {"1_13", "1_16", "1_18"}) {
                var name = "de/bluecolored/bluemap/core/world/mca/chunk/Chunk_" + version;
                var model = classFile.parse(jar.getInputStream(jar.getJarEntry(name + ".class")).readAllBytes());
                if (!model.thisClass().asInternalName().equals(name)
                    || model.methods().stream().filter(m -> m.methodName().equalsString("isGenerated")
                        && m.methodType().equalsString("()Z")).count() != 1) {
                    throw new IllegalStateException("Unexpected pinned BlueMap chunk contract");
                }
                var patched = classFile.transformClass(model, ClassTransform.transformingMethodBodies(
                    m -> m.methodName().equalsString("isGenerated") && m.methodType().equalsString("()Z"),
                    new CodeTransform() {
                        @Override
                        public void atStart(CodeBuilder code) {
                            // These classes represent actual on-disk chunks. The missing and
                            // errored chunk sentinels remain unchanged. Eligibility for this
                            // archival render does not depend on population or lighting flags.
                            code.iconst_1().ireturn();
                        }

                        @Override
                        public void accept(CodeBuilder code, CodeElement element) {
                            // Replace the original generation-status predicate completely.
                        }
                    }));
                var failures = classFile.verify(patched);
                if (!failures.isEmpty()) {
                    throw new IllegalStateException("Patched bytecode failed verification: " + failures);
                }
                var output = Path.of(args[1], name + ".class");
                Files.createDirectories(output.getParent());
                Files.write(output, patched);
            }
        }
    }
}
