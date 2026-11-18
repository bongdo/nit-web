package server

import (
	"bytes"
	"errors"
	"image"
	"image/draw"
	"image/jpeg"
	"image/png"
	"io"
	"strconv"
)

const (
	maxThumbSource = 16 << 20
	minThumbWidth  = 64
	maxThumbWidth  = 1600
	thumbQuality   = 82
)

func thumbWidth(raw string) int {
	if raw == "" {
		return 0
	}
	width, err := strconv.Atoi(raw)
	if err != nil || width < minThumbWidth {
		return 0
	}
	if width > maxThumbWidth {
		return maxThumbWidth
	}
	return width
}

func resizableImage(contentType string) bool {
	return contentType == "image/jpeg" || contentType == "image/png"
}

func resizeImage(body io.Reader, contentType string, width int) ([]byte, error) {
	raw, err := io.ReadAll(io.LimitReader(body, maxThumbSource+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > maxThumbSource {
		return nil, errors.New("image is too large to thumbnail")
	}
	source, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	bounds := source.Bounds()
	if bounds.Dx() <= width || bounds.Dy() == 0 {
		return raw, nil
	}
	height := bounds.Dy() * width / bounds.Dx()
	if height == 0 {
		return raw, nil
	}
	flat := image.NewRGBA(bounds)
	draw.Draw(flat, bounds, source, bounds.Min, draw.Src)
	scaled := image.NewRGBA(image.Rect(0, 0, width, height))
	boxSample(scaled, flat)
	var out bytes.Buffer
	if contentType == "image/png" {
		err = (&png.Encoder{CompressionLevel: png.BestSpeed}).Encode(&out, scaled)
	} else {
		err = jpeg.Encode(&out, scaled, &jpeg.Options{Quality: thumbQuality})
	}
	if err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func boxSample(dst, src *image.RGBA) {
	dstBounds := dst.Bounds()
	srcBounds := src.Bounds()
	scaleX := float64(srcBounds.Dx()) / float64(dstBounds.Dx())
	scaleY := float64(srcBounds.Dy()) / float64(dstBounds.Dy())
	for y := dstBounds.Min.Y; y < dstBounds.Max.Y; y++ {
		y0 := srcBounds.Min.Y + int(float64(y-dstBounds.Min.Y)*scaleY)
		y1 := srcBounds.Min.Y + int(float64(y-dstBounds.Min.Y+1)*scaleY)
		if y1 <= y0 {
			y1 = y0 + 1
		}
		for x := dstBounds.Min.X; x < dstBounds.Max.X; x++ {
			x0 := srcBounds.Min.X + int(float64(x-dstBounds.Min.X)*scaleX)
			x1 := srcBounds.Min.X + int(float64(x-dstBounds.Min.X+1)*scaleX)
			if x1 <= x0 {
				x1 = x0 + 1
			}
			var r, g, b, a, count uint32
			for sy := y0; sy < y1; sy++ {
				row := src.Pix[sy*src.Stride:]
				for sx := x0; sx < x1; sx++ {
					at := sx * 4
					r += uint32(row[at])
					g += uint32(row[at+1])
					b += uint32(row[at+2])
					a += uint32(row[at+3])
					count++
				}
			}
			at := dst.PixOffset(x, y)
			dst.Pix[at] = uint8(r / count)
			dst.Pix[at+1] = uint8(g / count)
			dst.Pix[at+2] = uint8(b / count)
			dst.Pix[at+3] = uint8(a / count)
		}
	}
}
