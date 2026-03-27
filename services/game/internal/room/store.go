package room

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/gssr/game/internal/db"
	"github.com/redis/go-redis/v9"
)

const roomTTL = 24 * time.Hour

type Store struct {
	v *db.Valkey
}

func NewStore(v *db.Valkey) *Store {
	return &Store{v: v}
}

func roomKey(id string) string {
	return fmt.Sprintf("room:%s", id)
}

func (s *Store) Get(ctx context.Context, id string) (*RoomState, error) {
	data, err := s.v.Client.Get(ctx, roomKey(id)).Bytes()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var r RoomState
	if err := json.Unmarshal(data, &r); err != nil {
		return nil, err
	}
	return &r, nil
}

func (s *Store) Set(ctx context.Context, r *RoomState) error {
	data, err := json.Marshal(r)
	if err != nil {
		return err
	}
	return s.v.Client.Set(ctx, roomKey(r.ID), data, roomTTL).Err()
}

func (s *Store) Delete(ctx context.Context, id string) error {
	return s.v.Client.Del(ctx, roomKey(id)).Err()
}
