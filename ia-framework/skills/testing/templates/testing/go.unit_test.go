package orders

import (
	"context"
	"errors"
	"testing"
)

func TestCreate_Conflict(t *testing.T) {
	svc := NewService(fakeStore{conflict: true})

	cases := []struct {
		name string
		in   CreateOrderRequest
		want error
	}{
		{"duplicated", CreateOrderRequest{ExternalRef: "PO-1", Status: "open"}, ErrConflict},
		{"valid", CreateOrderRequest{ExternalRef: "PO-2", Status: "open"}, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := svc.Create(context.Background(), c.in, "t1")
			if c.want == nil && err != nil {
				t.Fatalf("got %v want nil", err)
			}
			if c.want != nil && !errors.Is(err, c.want) {
				t.Errorf("got %v want %v", err, c.want)
			}
		})
	}
}

type fakeStore struct {
	conflict bool
}

func (f fakeStore) Create(ctx context.Context, o Order) error {
	if f.conflict {
		return ErrConflict
	}
	return nil
}
func (f fakeStore) FindByID(ctx context.Context, id uuid.UUID, tenantID string) (Order, error) {
	return Order{}, ErrNotFound
}