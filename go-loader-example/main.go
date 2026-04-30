package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/project-kessel/schema-unify/typespec-go-loader-example/schema"
)

func main() {
	var ir *schema.IntermediateRepresentation
	var err error

	if len(os.Args) > 1 {
		ir, err = schema.LoadFromFile(os.Args[1])
	} else {
		ir, err = schema.LoadEmbedded()
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Schema IR v%s (generated %s from %s)\n\n", ir.Version, ir.GeneratedAt, ir.Source)

	printResources(ir)
	printExtensions(ir)
	printMetadata(ir)
	printAnnotations(ir)
	printSpiceDBPreview(ir)
}

func printResources(ir *schema.IntermediateRepresentation) {
	fmt.Printf("=== Resources (%d) ===\n", len(ir.Resources))
	for _, res := range ir.Resources {
		fmt.Printf("  %s/%s\n", res.Namespace, res.Name)
		for _, rel := range res.Relations {
			pub := ""
			if rel.IsPublic {
				pub = " [public]"
			}
			fmt.Printf("    %-30s  %s%s\n", rel.Name, describeBody(rel.Body), pub)
		}
	}
	fmt.Println()
}

func printExtensions(ir *schema.IntermediateRepresentation) {
	fmt.Printf("=== V1 Extensions (%d) ===\n", len(ir.Extensions))
	for _, ext := range ir.Extensions {
		fmt.Printf("  %s:%s:%s -> %s\n", ext.Application, ext.Resource, ext.Verb, ext.V2Perm)
	}
	fmt.Println()
}

func printMetadata(ir *schema.IntermediateRepresentation) {
	fmt.Println("=== Service Metadata ===")
	for svc, meta := range ir.Metadata {
		fmt.Printf("  %s:\n", svc)
		if len(meta.Permissions) > 0 {
			fmt.Printf("    permissions: %s\n", strings.Join(meta.Permissions, ", "))
		}
		if len(meta.Resources) > 0 {
			fmt.Printf("    resources:   %s\n", strings.Join(meta.Resources, ", "))
		}
	}
	fmt.Println()
}

func printAnnotations(ir *schema.IntermediateRepresentation) {
	if len(ir.Annotations) == 0 {
		return
	}
	fmt.Println("=== Resource Annotations ===")
	for resource, kvs := range ir.Annotations {
		fmt.Printf("  %s:\n", resource)
		for key, value := range kvs {
			fmt.Printf("    %s: %s\n", key, value)
		}
	}
	fmt.Println()
}

func printSpiceDBPreview(ir *schema.IntermediateRepresentation) {
	lines := strings.Split(ir.SpiceDB, "\n")
	preview := lines
	if len(lines) > 15 {
		preview = lines[:15]
	}
	fmt.Printf("=== SpiceDB Schema (first %d lines) ===\n", len(preview))
	for _, line := range preview {
		fmt.Println(line)
	}
	if len(lines) > 15 {
		fmt.Printf("  ... (%d more lines)\n", len(lines)-15)
	}
}

func describeBody(b schema.RelationBody) string {
	switch b.Kind {
	case "assignable":
		return fmt.Sprintf("-> %s [%s]", b.Target, b.Cardinality)
	case "bool":
		return fmt.Sprintf("bool(%s)", b.Target)
	case "ref":
		return b.Name
	case "subref":
		return fmt.Sprintf("%s->%s", b.Name, b.Subname)
	case "or":
		parts := make([]string, len(b.Members))
		for i, m := range b.Members {
			parts[i] = describeBody(m)
		}
		return strings.Join(parts, " | ")
	case "and":
		parts := make([]string, len(b.Members))
		for i, m := range b.Members {
			parts[i] = describeBody(m)
		}
		return "(" + strings.Join(parts, " & ") + ")"
	default:
		return b.Kind
	}
}
