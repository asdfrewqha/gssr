package maps

import (
	"github.com/gofiber/fiber/v2"
	"github.com/gssr/game/internal/db"
)

type Handler struct {
	pg *db.Postgres
}

func NewHandler(pg *db.Postgres) *Handler {
	return &Handler{pg: pg}
}

type mapItem struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	XMin        float64 `json:"x_min"`
	XMax        float64 `json:"x_max"`
	YMin        float64 `json:"y_min"`
	YMax        float64 `json:"y_max"`
	CoordType   string  `json:"coord_type"`
}

type floorItem struct {
	ID          string `json:"id"`
	FloorNumber int    `json:"floor_number"`
	Label       string `json:"label"`
	ImageURL    string `json:"image_url"`
	PanoCount   int    `json:"pano_count"`
}

type mapDetail struct {
	mapItem
	Floors []floorItem `json:"floors"`
}

// List godoc
// @Summary      List all maps
// @Tags         maps
// @Produce      json
// @Success      200  {array}   mapItem
// @Router       /maps [get]
func (h *Handler) List(c *fiber.Ctx) error {
	rows, err := h.pg.Pool.Query(c.Context(),
		`SELECT id, name, COALESCE(description,''), x_min, x_max, y_min, y_max, coord_type
		 FROM maps ORDER BY name`)
	if err != nil {
		return fiber.ErrInternalServerError
	}
	defer rows.Close()

	result := make([]mapItem, 0)
	for rows.Next() {
		var m mapItem
		if err := rows.Scan(&m.ID, &m.Name, &m.Description,
			&m.XMin, &m.XMax, &m.YMin, &m.YMax, &m.CoordType); err != nil {
			return fiber.ErrInternalServerError
		}
		result = append(result, m)
	}
	return c.JSON(result)
}

// Get godoc
// @Summary      Get map with floors and panorama counts
// @Tags         maps
// @Produce      json
// @Param        id   path      string  true  "Map UUID"
// @Success      200  {object}  mapDetail
// @Failure      404  {object}  fiber.Map
// @Router       /maps/{id} [get]
func (h *Handler) Get(c *fiber.Ctx) error {
	id := c.Params("id")

	var m mapDetail
	err := h.pg.Pool.QueryRow(c.Context(),
		`SELECT id, name, COALESCE(description,''), x_min, x_max, y_min, y_max, coord_type
		 FROM maps WHERE id = $1`, id,
	).Scan(&m.ID, &m.Name, &m.Description,
		&m.XMin, &m.XMax, &m.YMin, &m.YMax, &m.CoordType)
	if err != nil {
		return fiber.ErrNotFound
	}

	rows, err := h.pg.Pool.Query(c.Context(),
		`SELECT f.id, f.floor_number, COALESCE(f.label,''), f.image_url,
		        COUNT(p.id) FILTER (WHERE p.tile_status = 'tiled' AND p.moderation_status = 'clean')
		 FROM floors f
		 LEFT JOIN panoramas p ON p.floor_id = f.id
		 WHERE f.map_id = $1
		 GROUP BY f.id, f.floor_number, f.label, f.image_url
		 ORDER BY f.floor_number`, id)
	if err != nil {
		return fiber.ErrInternalServerError
	}
	defer rows.Close()

	m.Floors = make([]floorItem, 0)
	for rows.Next() {
		var f floorItem
		if err := rows.Scan(&f.ID, &f.FloorNumber, &f.Label, &f.ImageURL, &f.PanoCount); err != nil {
			return fiber.ErrInternalServerError
		}
		m.Floors = append(m.Floors, f)
	}
	return c.JSON(m)
}
