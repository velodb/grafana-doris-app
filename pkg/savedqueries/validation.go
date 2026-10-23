package savedqueries

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"
)

func validateInput(name, description string, raw json.RawMessage) error {
	if name == "" || utf8.RuneCountInString(name) > 120 {
		return fmt.Errorf("name must contain 1–120 characters")
	}
	if utf8.RuneCountInString(description) > 2000 {
		return fmt.Errorf("description exceeds 2000 characters")
	}
	var state map[string]any
	if err := json.Unmarshal(raw, &state); err != nil || state == nil {
		return fmt.Errorf("invalid Discover state")
	}
	if state["version"] != float64(1) {
		return fmt.Errorf("unsupported Discover state version")
	}
	for _, key := range []string{"datasource", "database", "table", "timeField", "timeZone", "mode"} {
		v, ok := state[key].(string)
		if !ok || strings.TrimSpace(v) == "" {
			return fmt.Errorf("state.%s is required", key)
		}
	}
	mode := state["mode"]
	if mode != "SQL" && mode != "Search" && mode != "Lucene" {
		return fmt.Errorf("invalid query mode")
	}
	for _, key := range []string{"query", "timeRawFrom", "timeRawTo", "startTime", "endTime"} {
		if v, exists := state[key]; exists {
			if _, ok := v.(string); !ok {
				return fmt.Errorf("state.%s must be a string", key)
			}
		}
	}
	text := func(key string) string { v, _ := state[key].(string); return v }
	if !(strings.HasPrefix(text("timeRawFrom"), "now") && strings.HasPrefix(text("timeRawTo"), "now")) && (text("startTime") == "" || text("endTime") == "") {
		return fmt.Errorf("a complete time range is required")
	}
	filters, ok := state["filters"].([]any)
	if !ok {
		return fmt.Errorf("filters must be an array")
	}
	for _, v := range filters {
		f, ok := v.(map[string]any)
		if !ok {
			return fmt.Errorf("invalid filter")
		}
		for _, key := range []string{"id", "fieldName", "operator"} {
			if s, ok := f[key].(string); !ok || s == "" {
				return fmt.Errorf("invalid filter.%s", key)
			}
		}
		switch f["operator"] {
		case "=", "!=", "in", "not in", "is null", "is not null", "between", "not between", "like", "not like", "match_all", "match_any", "match_phrase", "match_phrase_prefix":
		default:
			return fmt.Errorf("invalid filter operator")
		}
		values, ok := f["value"].([]any)
		if !ok {
			return fmt.Errorf("invalid filter values")
		}
		for _, value := range values {
			switch value.(type) {
			case string, float64, bool:
			default:
				return fmt.Errorf("filter values must be scalar")
			}
		}
		if err := optionalStrings(f, "variantPath"); err != nil {
			return err
		}
		for _, key := range []string{"variantKey", "variantRootType", "fieldType", "label"} {
			if v, exists := f[key]; exists {
				if _, ok := v.(string); !ok {
					return fmt.Errorf("invalid filter.%s", key)
				}
			}
		}
	}
	fields, ok := state["selectedFields"].([]any)
	if !ok {
		return fmt.Errorf("selectedFields must be an array")
	}
	for _, v := range fields {
		f, ok := v.(map[string]any)
		if !ok {
			return fmt.Errorf("invalid selected field")
		}
		if s, ok := f["Field"].(string); !ok || s == "" {
			return fmt.Errorf("selected field name is required")
		}
		if err := optionalStrings(f, "variantPath"); err != nil {
			return err
		}
		for _, key := range []string{"Type", "variantKey"} {
			if v, exists := f[key]; exists {
				if _, ok := v.(string); !ok {
					return fmt.Errorf("invalid selected field.%s", key)
				}
			}
		}
	}
	if _, ok := state["columnOrder"].([]any); !ok {
		return fmt.Errorf("columnOrder must be an array")
	}
	if err := optionalStrings(state, "columnOrder"); err != nil {
		return err
	}
	sort, ok := state["sort"].(map[string]any)
	if !ok {
		return fmt.Errorf("invalid sort")
	}
	if _, ok := sort["field"].(string); !ok {
		return fmt.Errorf("invalid sort field")
	}
	if sort["direction"] != "ASC" && sort["direction"] != "DESC" {
		return fmt.Errorf("invalid sort direction")
	}
	if err := optionalStrings(sort, "variantPath"); err != nil {
		return err
	}
	if v, exists := sort["variantType"]; exists {
		if _, ok := v.(string); !ok {
			return fmt.Errorf("invalid sort variantType")
		}
	}
	return nil
}

func optionalStrings(object map[string]any, key string) error {
	v, exists := object[key]
	if !exists {
		return nil
	}
	values, ok := v.([]any)
	if !ok {
		return fmt.Errorf("%s must be a string array", key)
	}
	for _, value := range values {
		if _, ok := value.(string); !ok {
			return fmt.Errorf("%s must be a string array", key)
		}
	}
	return nil
}
