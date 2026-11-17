package server

import (
	"bytes"
	"encoding/binary"
	"testing"
)

func wavFile(rate uint32, pcm []byte, declared uint32) []byte {
	var buffer bytes.Buffer
	buffer.WriteString("RIFF")
	binary.Write(&buffer, binary.LittleEndian, declared)
	buffer.WriteString("WAVE")
	buffer.WriteString("fmt ")
	binary.Write(&buffer, binary.LittleEndian, uint32(16))
	binary.Write(&buffer, binary.LittleEndian, uint16(1))
	binary.Write(&buffer, binary.LittleEndian, uint16(1))
	binary.Write(&buffer, binary.LittleEndian, rate)
	binary.Write(&buffer, binary.LittleEndian, rate*2)
	binary.Write(&buffer, binary.LittleEndian, uint16(2))
	binary.Write(&buffer, binary.LittleEndian, uint16(16))
	buffer.WriteString("data")
	binary.Write(&buffer, binary.LittleEndian, uint32(len(pcm)))
	buffer.Write(pcm)
	return buffer.Bytes()
}

func TestWavComplete(t *testing.T) {
	complete := wavFile(22050, []byte{0, 1, 2, 3}, 40)
	huge := wavFile(22050, []byte{0, 1, 2, 3}, 40)
	binary.LittleEndian.PutUint32(huge[40:44], 0xFFFFFFFF)
	cases := []struct {
		name     string
		data     []byte
		complete bool
		ok       bool
	}{
		{"complete", complete, true, true},
		{"truncated payload", complete[:30], false, true},
		{"not a wav", []byte("RIFFxxxxNOPE"), false, false},
		{"header only", complete[:12], false, true},
		{"huge data size", huge, false, true},
		{"empty payload", wavFile(22050, nil, 36), false, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotComplete, gotOK := wavComplete(tc.data)
			if gotComplete != tc.complete || gotOK != tc.ok {
				t.Fatalf("wavComplete = %v,%v want %v,%v", gotComplete, gotOK, tc.complete, tc.ok)
			}
		})
	}
}

func TestWavPCM(t *testing.T) {
	pcm := []byte{0, 1, 2, 3, 4, 5}
	data := wavFile(16000, pcm, uint32(36+len(pcm)))
	got, rate, ok := wavPCM(data)
	if !ok || rate != 16000 || !bytes.Equal(got, pcm) {
		t.Fatalf("wavPCM = %v,%d,%v", got, rate, ok)
	}
	if _, _, ok := wavPCM([]byte("not a wav file")); ok {
		t.Fatal("wavPCM accepted a non-wav")
	}
}
