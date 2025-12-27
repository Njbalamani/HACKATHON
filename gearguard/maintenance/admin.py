from django.contrib import admin
from .models import Equipment, MaintenanceTeam, MaintenanceRequest

admin.site.register(Equipment)
admin.site.register(MaintenanceTeam)
admin.site.register(MaintenanceRequest)
