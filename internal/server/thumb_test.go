package server

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

func sampleImage(t *testing.T, width, height int, format string) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x % 256), G: uint8(y % 256), B: 128, A: 255})
		}
	}
	var buffer bytes.Buffer
	var err error
	if format == "image/png" {
		err = png.Encode(&buffer, img)
	} else {
		err = jpeg.Encode(&buffer, img, nil)
	}
	if err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func TestResizeImageScalesToWidth(t *testing.T) {
	for _, format := range []string{"image/jpeg", "image/png"} {
		raw := sampleImage(t, 400, 200, format)
		out, err := resizeImage(bytes.NewReader(raw), format, 100)
		if err != nil {
			t.Fatalf("%s: %v", format, err)
		}
		img, _, err := image.Decode(bytes.NewReader(out))
		if err != nil {
			t.Fatalf("%s decode: %v", format, err)
		}
		if got := img.Bounds(); got.Dx() != 100 || got.Dy() != 50 {
			t.Fatalf("%s bounds = %v, want 100x50", format, got)
		}
	}
}

func TestResizeImageKeepsSmallImages(t *testing.T) {
	raw := sampleImage(t, 100, 50, "image/jpeg")
	out, err := resizeImage(bytes.NewReader(raw), "image/jpeg", 768)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(out, raw) {
		t.Fatal("image narrower than the target was re-encoded")
	}
}

func TestResizeImageRejectsBrokenInput(t *testing.T) {
	if _, err := resizeImage(bytes.NewReader([]byte("not an image")), "image/jpeg", 320); err == nil {
		t.Fatal("broken image was resized")
	}
}

func TestThumbWidthBounds(t *testing.T) {
	if thumbWidth("") != 0 || thumbWidth("10") != 0 || thumbWidth("abc") != 0 {
		t.Fatal("thumb width accepted a value below the minimum")
	}
	if thumbWidth("480") != 480 {
		t.Fatal("thumb width rejected a valid value")
	}
	if thumbWidth("9000") != maxThumbWidth {
		t.Fatal("thumb width was not capped")
	}
}
