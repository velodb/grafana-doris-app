package plugin

import (
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"net/http"
)

func writeJWKS(w http.ResponseWriter, key *rsa.PublicKey, kid string) {
	width := len(key.N.Bytes())
	e := make([]byte, 0, 4)
	for value := key.E; value > 0; value >>= 8 {
		e = append([]byte{byte(value)}, e...)
	}
	if len(e) == 0 {
		e = []byte{0}
	}
	w.Header().Set("Content-Type", "application/jwk-set+json")
	w.Header().Set("Cache-Control", "public, max-age=300")
	_ = json.NewEncoder(w).Encode(jwkSet{Keys: []jwk{{Kty: "RSA", Use: "sig", Alg: "RS256", Kid: kid, N: base64.RawURLEncoding.EncodeToString(leftPad(key.N.Bytes(), width)), E: base64.RawURLEncoding.EncodeToString(e)}}})
}

func leftPad(value []byte, width int) []byte {
	if len(value) >= width {
		return value
	}
	out := make([]byte, width)
	copy(out[width-len(value):], value)
	return out
}
