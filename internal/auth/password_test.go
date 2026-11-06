package auth

import "testing"

func TestHashVerify(t *testing.T) {
	hash, err := Hash("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	if !Verify(hash, "correct horse battery staple") {
		t.Fatal("valid password rejected")
	}
	if Verify(hash, "wrong") {
		t.Fatal("wrong password accepted")
	}
	if Verify("broken", "correct horse battery staple") {
		t.Fatal("broken hash accepted")
	}
}

func TestGenerate(t *testing.T) {
	first, err := Generate(24)
	if err != nil {
		t.Fatal(err)
	}
	second, err := Generate(24)
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 24 || len(second) != 24 {
		t.Fatalf("unexpected lengths: %d, %d", len(first), len(second))
	}
	if first == second {
		t.Fatal("generated passwords are identical")
	}
}
