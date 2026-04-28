import { useState } from 'react';

export function DroneCard({ drone, onClick, isSelectedForRoute = false }) {
  const [isHovered, setIsHovered] = useState(false);

  const canBeAssignedToMission = 
    drone.isVisible && 
    drone.status !== 'в полете' && 
    drone.status !== 'заряжается' &&
    drone.battery > 20;

  const getStatusColor = (status) => {
    switch(status) {
      case 'в полете':
        return 'text-green-400';
      case 'заряжается':
        return 'text-yellow-400';
      case 'на земле':
        return 'text-blue-400';
      case 'возвращается':
        return 'text-orange-400';
      case 'неактивен':
        return 'text-gray-400';
      default:
        return 'text-gray-400';
    }
  };

  const getStatusIcon = (status) => {
    switch(status) {
      case 'в полете':
        return '🚁';
      case 'заряжается':
        return '🔋';
      case 'на земле':
        return '🛬';
      case 'возвращается':
        return '↩️';
      case 'неактивен':
        return '⏸️';
      default:
        return '📡';
    }
  };

  const getBatteryIcon = (battery) => {
    if (battery > 70) return '🟢';
    if (battery > 40) return '🟡';
    if (battery > 20) return '🟠';
    return '🔴';
  };

  return (
    <div 
      className={`cursor-pointer transition-all duration-200 ${
        isSelectedForRoute 
          ? 'ring-2 ring-blue-500 ring-opacity-80 bg-blue-900/20' 
          : 'hover:bg-gray-800'
      } ${drone.missionId ? 'border-l-4 border-green-500' : ''}`}
      onClick={() => onClick(drone)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex justify-between items-start p-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className={`font-bold ${
              isSelectedForRoute ? 'text-blue-300' : 'text-white'
            }`}>
              {drone.name}
            </h3>
            
            {drone.missionId && (
              <span className="text-xs bg-green-900 text-green-300 px-2 py-1 rounded-full flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></span>
                Миссия
              </span>
            )}
            
            {isSelectedForRoute && (
              <span className="text-xs bg-blue-900 text-blue-300 px-2 py-1 rounded-full flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse"></span>
                Маршрут
              </span>
            )}
          </div>
          
          <p className="text-sm text-gray-400 mb-2">
            {drone.model}
          </p>
          
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1">
              <span className="text-gray-500">{getStatusIcon(drone.status)}</span>
              <span className={getStatusColor(drone.status)}>
                {drone.status}
              </span>
            </div>
            
            <div className="flex items-center gap-1">
              <span className={getBatteryIcon(drone.battery)}></span>
              <span className={`font-medium ${
                drone.battery > 50 ? 'text-green-400' :
                drone.battery > 20 ? 'text-yellow-400' : 'text-red-400'
              }`}>
                {drone.battery}%
              </span>
            </div>
            
            {drone.speed > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-gray-500">⚡</span>
                <span className="text-gray-300">{drone.speed.toFixed(1)} м/с</span>
              </div>
            )}
            
            {drone.altitude > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-gray-500">📏</span>
                <span className="text-gray-300">{drone.altitude.toFixed(0)} м</span>
              </div>
            )}
          </div>
          
          {!canBeAssignedToMission && drone.isVisible && (
            <div className="mt-2 text-xs flex items-center gap-2">
              <span className="text-red-400 font-medium">⚠️ Ограничения:</span>
              {drone.status === 'в полете' && (
                <span className="text-red-300">На миссии</span>
              )}
              {drone.status === 'заряжается' && (
                <span className="text-yellow-300">Заряжается</span>
              )}
              {drone.battery <= 20 && (
                <span className="text-red-300">Низкий заряд</span>
              )}
            </div>
          )}
        </div>
        
        <div className="flex flex-col items-end gap-1">
          <div className={`text-xs px-2 py-1 rounded ${
            drone.isVisible 
              ? 'bg-green-900/50 text-green-300' 
              : 'bg-gray-700 text-gray-400'
          }`}>
            {drone.isVisible ? 'На карте' : 'Скрыт'}
          </div>
        </div>
      </div>
      
      {drone.path && drone.path.length > 0 && (
        <div className="px-3 pb-2">
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Маршрут: {drone.path.length} точек</span>
            <span className={`${
              isSelectedForRoute ? 'text-blue-400' : 'text-gray-500'
            }`}>
              {drone.path.length > 0 ? 'Готов к миссии' : 'Нет маршрута'}
            </span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-1.5">
            <div 
              className={`h-1.5 rounded-full ${
                isSelectedForRoute ? 'bg-blue-500' : 'bg-green-500'
              }`}
              style={{ 
                width: `${Math.min(100, (drone.path.length / 20) * 100)}%` 
              }}
            ></div>
          </div>
        </div>
      )}
      
      {isSelectedForRoute && (
        <div className="px-3 pb-2">
          <div className="text-xs text-blue-300 flex items-center justify-center gap-2 p-2 bg-blue-900/30 rounded">
            <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
            Выбран для построения маршрута и миссий
          </div>
        </div>
      )}
    </div>
  );
}

export function DroneSidebarList({ drones, selectedDroneId, onDroneClick }) {
  return (
    <div className="space-y-2">
      {drones.map(drone => (
        <DroneCard
          key={drone.id}
          drone={drone}
          onClick={onDroneClick}
          isSelectedForRoute={drone.id === selectedDroneId}
        />
      ))}
    </div>
  );
}