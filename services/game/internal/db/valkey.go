package db

import (
	"context"

	"github.com/redis/go-redis/v9"
)

type Valkey struct {
	Client *redis.Client
}

func NewValkey(url string) (*Valkey, error) {
	opt, err := redis.ParseURL(url)
	if err != nil {
		return nil, err
	}
	client := redis.NewClient(opt)
	if err := client.Ping(context.Background()).Err(); err != nil {
		return nil, err
	}
	return &Valkey{Client: client}, nil
}

func (v *Valkey) Close() error {
	return v.Client.Close()
}
