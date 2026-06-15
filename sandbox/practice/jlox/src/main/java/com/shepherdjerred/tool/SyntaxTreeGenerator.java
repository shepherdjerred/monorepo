package com.shepherdjerred.tool;

import java.io.IOException;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;

/**
 * Generates the Expr class based on a language definition.
 */
public class SyntaxTreeGenerator {

  public static void main(String[] args) throws IOException {
    if (args.length != 1) {
      System.err.println("Usage: generate_ast <output directory>");
      System.exit(1);
    }
    String outputDir = args[0];

    defineAst(outputDir, "Expr", Arrays.asList(
        "Binary   : Expr left, Token operator, Expr right",
        "Grouping : Expr expression",
        "Literal  : Object value",
        "Unary    : Token operator, Expr right"
    ));
    defineAst(outputDir, "Stmt", Arrays.asList(
        "Expr : Expr expression",
        "Print      : Expr expression"
    ));
  }

  private static void defineAst(String outputDir, String baseName, List<String> types)
      throws IOException {
    String path = outputDir + "/" + baseName + ".java";
    PrintWriter writer = new PrintWriter(path, StandardCharsets.UTF_8);

    writer.println("package com.shepherdjerred.jlox;");
    writer.println();
    writer.println("import java.util.List;");
    writer.println();
    writer.println("abstract class " + baseName + " {");

    defineVisitor(writer, baseName, types);

    // The base accept() method.
    writer.println();
    writer.println("  abstract <R> R accept(Visitor<R> visitor);");

    // The AST classes.
    for (String type : types) {
      String className = type.split(":")[0].trim();
      String fields = type.split(":")[1].trim();
      defineType(writer, baseName, className, fields);
    }

    writer.println("}");
    writer.close();
  }

  private static void defineVisitor(
      PrintWriter writer, String baseName, List<String> types) {
    writer.println("  interface Visitor<R> {");

    for (String type : types) {
      String typeName = type.split(":")[0].trim();
      writer.println();
      writer.println(
          "    R visit" + typeName + baseName + "(" + typeName + " " + baseName.toLowerCase()
              + ");");
    }

    writer.println("  }");
  }

  private static void defineType(
      PrintWriter writer, String baseName,
      String className, String fieldList) {
    writer.println();
    writer.println("  static class " + className + " extends " + baseName + " {");

    // Fields.
    String[] fields = fieldList.split(", ");
    for (String field : fields) {
      writer.println("    final " + field + ";");
    }

    // Constructor.
    writer.println();
    writer.println("    " + className + "(" + fieldList + ") {");

    // Store parameters in fields.
    for (String field : fields) {
      String name = field.split(" ")[1];
      writer.println("      this." + name + " = " + name + ";");
    }

    writer.println("    }");

    // Visitor pattern.
    writer.println();
    writer.println("    <R> R accept(Visitor<R> visitor) {");
    writer.println("      return visitor.visit" + className + baseName + "(this);");
    writer.println("    }");

    writer.println("  }");
  }
}
