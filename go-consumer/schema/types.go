package schema

// IntermediateRepresentation is the top-level IR produced by the TypeSpec emitter.
// It captures the full type graph: resources, extensions, generated SpiceDB schema,
// service metadata, and unified JSON schemas -- all from a single TypeSpec compilation.
type IntermediateRepresentation struct {
	Version     string                       `json:"version"`
	GeneratedAt string                       `json:"generatedAt"`
	Source      string                       `json:"source"`
	Resources   []ResourceDef                `json:"resources"`
	Extensions  []V1Extension                `json:"extensions"`
	SpiceDB     string                       `json:"spicedb"`
	Metadata    map[string]ServiceMetadata   `json:"metadata"`
	JSONSchemas map[string]UnifiedJSONSchema `json:"jsonSchemas"`
}

type ResourceDef struct {
	Name      string        `json:"name"`
	Namespace string        `json:"namespace"`
	Relations []RelationDef `json:"relations"`
}

type RelationDef struct {
	Name     string       `json:"name"`
	Body     RelationBody `json:"body"`
	IsPublic bool         `json:"isPublic,omitempty"`
}

// RelationBody is a polymorphic type discriminated by "kind".
// Possible kinds: assignable, bool, ref, subref, or, and.
type RelationBody struct {
	Kind        string         `json:"kind"`
	Target      string         `json:"target,omitempty"`
	Cardinality string         `json:"cardinality,omitempty"`
	Name        string         `json:"name,omitempty"`
	Subname     string         `json:"subname,omitempty"`
	Members     []RelationBody `json:"members,omitempty"`
}

type V1Extension struct {
	Application string `json:"application"`
	Resource    string `json:"resource"`
	Verb        string `json:"verb"`
	V2Perm      string `json:"v2Perm"`
}

type ServiceMetadata struct {
	Permissions []string `json:"permissions"`
	Resources   []string `json:"resources"`
}

type UnifiedJSONSchema struct {
	Schema     string                    `json:"$schema"`
	ID         string                    `json:"$id"`
	Type       string                    `json:"type"`
	Properties map[string]SchemaProperty `json:"properties"`
	Required   []string                  `json:"required"`
}

type SchemaProperty struct {
	Type   string `json:"type"`
	Format string `json:"format,omitempty"`
	Source string `json:"source,omitempty"`
}
