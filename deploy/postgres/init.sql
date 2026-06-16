-- Создаёт базы для backend и vineyardApp (Solid Queue/Cache/Cable — отдельные БД).

CREATE DATABASE vineyard_monitoring_production OWNER vineyard_user;
CREATE DATABASE vineyard_monitoring_production_cache OWNER vineyard_user;
CREATE DATABASE vineyard_monitoring_production_queue OWNER vineyard_user;
CREATE DATABASE vineyard_monitoring_production_cable OWNER vineyard_user;

CREATE DATABASE vineyard_app_production OWNER vineyard_user;
CREATE DATABASE vineyard_app_production_cache OWNER vineyard_user;
CREATE DATABASE vineyard_app_production_queue OWNER vineyard_user;
CREATE DATABASE vineyard_app_production_cable OWNER vineyard_user;
