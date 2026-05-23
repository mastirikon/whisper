from app import create_app
from app.config import DevelopmentConfig, ProductionConfig
import os

_env = os.environ.get("FLASK_ENV", "production").lower()
_config = DevelopmentConfig if _env == "development" else ProductionConfig

app = create_app(_config)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
